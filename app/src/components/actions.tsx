"use client";

/**
 * Buy, sell, and redeem.
 *
 * Each builds instructions with the shared client, has Privy sign the compiled
 * bytes, and broadcasts through the app's own RPC. The buyer's token accounts
 * are created idempotently in the same transaction, so there is never a
 * separate "set up your account" step.
 *
 * A buy is paid in SOL. The transaction swaps it into the narrative's stock
 * first (Jupiter on mainnet, the app's faucet on devnet — see src/lib/swap.ts)
 * and the program's `buy` spends that stock, so the wallet never has to hold
 * the stock itself. Selling pays out in the stock.
 */

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import {
  afterBuy,
  applyBps,
  buyCost,
  formatStock,
  netSellProceeds,
  proRata,
  remaining,
  sellRefund,
  spotPrice,
  tokensForStock,
  usdToStock,
  getBuyInstruction,
  getRedeemInstruction,
  getSellInstruction,
} from "@nm/client";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { createNoopSigner, type Address, type Instruction } from "@solana/kit";

import {
  formatUsd,
  formatUsdAuto,
  SOLANA_CHAIN,
  TOKEN_2022_PROGRAM,
} from "@/lib/config";
import type { NarrativeRow, Position } from "@/lib/narratives";
import { useSolPrice } from "@/lib/stocks";
import { buildSwapLeg, LAMPORTS_PER_SOL, quoteSwap, type SwapQuote } from "@/lib/swap";
import { signAndSend, toUserMessage, type BuildOptions } from "@/lib/tx";
import { Button, Notice, Panel } from "./ui";
import { refreshSolBalances, useSolBalance } from "./wallet";

/** SOL kept back for fees and the token accounts a first buy creates. */
const SOL_RESERVE = 0.01;

type Props = {
  narrative: NarrativeRow;
  position: Position | null;
  owner: Address;
  stockPrice: number;
  onDone: () => void;
};

/** Signs with Privy, broadcasts locally, surfaces whatever goes wrong. */
function useAction(onDone: () => void) {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const run = async (owner: Address, instructions: Instruction[], options: BuildOptions = {}) => {
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) {
      setError("No Solana wallet connected.");
      return;
    }

    setBusy(true);
    setError(null);
    setSignature(null);

    try {
      const sig = await signAndSend(
        owner,
        instructions,
        async (transaction) => {
          const { signedTransaction } = await signTransaction({
            transaction,
            wallet,
            // Omitting this would silently sign for mainnet.
            chain: SOLANA_CHAIN,
          });
          return signedTransaction;
        },
        options,
      );
      setSignature(sig);
      refreshSolBalances();
      onDone();
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return { run, busy, error, signature };
}

/** Errors need reading, so they get their own line. Success lives in the button. */
function Result({ error }: { error: string | null; signature?: string | null }) {
  if (error) return <Notice kind="error">{error}</Notice>;
  return null;
}

/** How long the button wears the confirmation before going back to normal. */
const CONFIRMED_MS = 4000;

/**
 * An action button that turns into its own receipt. When the signature
 * lands, the button shows "Confirmed" and the start of the signature for a
 * few seconds, then reverts. Nothing else on the panel moves, so a buy does
 * not shove the layout open and shut.
 */
function TxButton({
  signature,
  busy,
  busyLabel = "Confirming…",
  children,
  className = "",
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & {
  signature: string | null;
  busy: boolean;
  busyLabel?: string;
}) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!signature) return;
    setShown(signature);
    const timer = setTimeout(() => setShown(null), CONFIRMED_MS);
    return () => clearTimeout(timer);
  }, [signature]);

  if (shown && !busy) {
    return (
      <Button
        {...props}
        disabled={disabled}
        className={`${className} !bg-success-fill !text-success`}
        title={shown}
      >
        <span className="inline-flex items-center gap-2">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          Confirmed
          <span className="numeric text-xs opacity-60">{shown.slice(0, 8)}…</span>
        </span>
      </Button>
    );
  }
  return (
    <Button {...props} disabled={disabled || busy} className={className}>
      {busy ? busyLabel : children}
    </Button>
  );
}

async function ataFor(
  mint: Address,
  owner: Address,
  tokenProgram: Address = TOKEN_PROGRAM_ADDRESS,
): Promise<Address> {
  const [pda] = await findAssociatedTokenPda({ mint, owner, tokenProgram });
  return pda;
}

function Line({
  label,
  children,
  strong = false,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <span className="text-neutral-400">{label}</span>
      <span
        className={`mono text-right ${strong ? "font-medium text-neutral-900" : "text-neutral-600"}`}
      >
        {children}
      </span>
    </div>
  );
}

export function BuyPanel({
  narrative,
  position,
  owner,
  stockPrice,
  onDone,
}: Props) {
  const [dollars, setDollars] = useState("25");
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [details, setDetails] = useState(false);
  const { run, busy, error, signature } = useAction(onDone);

  const stock = narrative.stock;
  const swapStock = {
    mint: narrative.stockMint,
    decimals: stock.decimals,
    tokenProgram: narrative.stockTokenProgram,
  };
  const toUsd = (units: bigint | number) =>
    (Number(units) / 10 ** stock.decimals) * stockPrice;

  const solUsd = useSolPrice();
  const solBalance = useSolBalance(owner);

  const usd = Number.parseFloat(dollars);
  const lamports =
    Number.isFinite(usd) && usd > 0 && solUsd !== null && solUsd > 0
      ? BigInt(Math.round((usd / solUsd) * Number(LAMPORTS_PER_SOL)))
      : 0n;

  // The swap is quoted live, a beat after the amount settles.
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (lamports === 0n) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const next = await quoteSwap(swapStock, lamports);
        if (!cancelled) setQuote(next);
      } catch (cause) {
        if (!cancelled) setQuoteError(cause instanceof Error ? cause.message : String(cause));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The stock is fixed per narrative; only the amount changes the quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lamports, narrative.stockMint]);

  // Sized from the least the swap can deliver, so the buy cannot come up short.
  const stockIn = quote?.minStockOut ?? (stockPrice > 0 ? usdToStock(usd || 0, stockPrice, stock.decimals) : 0n);
  const left = remaining(narrative.supply);
  const soldOut = left === 0n;
  const tokens = tokensForStock(narrative, narrative.supply, stockIn, narrative.feeBps);
  const cost = tokens > 0n ? buyCost(narrative, tokens) : 0n;
  const fee = applyBps(cost, narrative.feeBps);
  const maxIn = cost + fee;
  const solIn = Number(lamports) / Number(LAMPORTS_PER_SOL);

  // Price impact: how far your own buy pushes the marginal price.
  const before = spotPrice(narrative);
  const after = tokens > 0n ? spotPrice(afterBuy(narrative, tokens)) : before;
  const impactPct = tokens > 0n && before > 0 ? ((after - before) / before) * 100 : 0;
  const avgPerToken = tokens > 0n ? Number(cost) / Number(tokens) : 0;

  const stockBalance = position?.stockBalance ?? 0n;
  const insufficient =
    lamports > 0n && solBalance !== null && solBalance < solIn + SOL_RESERVE;

  const held = position?.tokens ?? 0n;
  const sellAll = held > 0n && held <= narrative.supply;
  const proceeds = sellAll
    ? netSellProceeds(narrative, held, narrative.sellTaxBps)
    : 0n;
  const tax = sellAll
    ? applyBps(sellRefund(narrative, held), narrative.sellTaxBps)
    : 0n;

  const buy = async () => {
    if (!quote) return;
    const program = narrative.stockTokenProgram;
    const stockAta = await ataFor(narrative.stockMint, owner, program);
    const tokenAta = await ataFor(
      narrative.narrativeMint,
      owner,
      TOKEN_2022_PROGRAM,
    );
    const creatorFee = await ataFor(narrative.stockMint, narrative.creator, program);

    // The swap runs first; whatever it delivers above `maxIn` stays in the wallet.
    const swap = await buildSwapLeg(swapStock, owner, quote);

    await run(owner, [
      ...swap.instructions,
      getCreateAssociatedTokenIdempotentInstruction({
        payer: createNoopSigner(owner),
        ata: tokenAta,
        owner,
        mint: narrative.narrativeMint,
        tokenProgram: TOKEN_2022_PROGRAM,
      }),
      getCreateAssociatedTokenIdempotentInstruction({
        payer: createNoopSigner(owner),
        ata: creatorFee,
        owner: narrative.creator,
        mint: narrative.stockMint,
        tokenProgram: program,
      }),
      getBuyInstruction({
        buyer: owner,
        narrative: narrative.address,
        narrativeMint: narrative.narrativeMint,
        buyerTokenAccount: tokenAta,
        buyerStockAccount: stockAta,
        vault: narrative.vault,
        creatorFeeAccount: creatorFee,
        stockMint: narrative.stockMint,
        stockTokenProgram: program,
        tokensOut: tokens,
        maxStockIn: maxIn,
      }),
    ], { remoteSigners: swap.remoteSigners, lookupTables: swap.lookupTables });
  };

  const sell = async () => {
    const program = narrative.stockTokenProgram;
    const stockAta = await ataFor(narrative.stockMint, owner, program);
    const tokenAta = await ataFor(
      narrative.narrativeMint,
      owner,
      TOKEN_2022_PROGRAM,
    );

    await run(owner, [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: createNoopSigner(owner),
        ata: stockAta,
        owner,
        mint: narrative.stockMint,
        tokenProgram: program,
      }),
      getSellInstruction({
        seller: owner,
        narrative: narrative.address,
        narrativeMint: narrative.narrativeMint,
        sellerTokenAccount: tokenAta,
        sellerStockAccount: stockAta,
        vault: narrative.vault,
        stockMint: narrative.stockMint,
        stockTokenProgram: program,
        tokensIn: held,
        minStockOut: 0n,
      }),
    ]);
  };

  // Spendable SOL in dollars, with the reserve held back.
  const availableUsd =
    solBalance !== null && solUsd !== null ? Math.max(0, solBalance - SOL_RESERVE) * solUsd : 0;
  const setMax = () =>
    setDollars(availableUsd > 0 ? (Math.floor(availableUsd * 100) / 100).toString() : "0");

  return (
    <div className="space-y-3">
      {held > 0n ? (
        <div className="flex gap-5 text-sm font-medium">
          <button
            type="button"
            aria-pressed={mode === "buy"}
            onClick={() => setMode("buy")}
            className={`-mb-px border-b-2 pb-2 transition-colors ${
              mode === "buy" ? "border-success text-success" : "border-transparent text-neutral-400 hover:text-neutral-900"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            aria-pressed={mode === "sell"}
            onClick={() => setMode("sell")}
            className={`-mb-px border-b-2 pb-2 transition-colors ${
              mode === "sell" ? "border-danger text-danger" : "border-transparent text-neutral-400 hover:text-neutral-900"
            }`}
          >
            Sell
          </button>
        </div>
      ) : null}

      {mode === "buy" ? (
        <>
          {/* One big number, as on a trading app. */}
          <label className="block rounded border border-neutral-200 bg-neutral-100 px-3.5 py-3 focus-within:border-neutral-400">
            <div className="flex items-baseline gap-1">
              <span className="numeric text-2xl font-semibold text-neutral-400">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={dollars}
                onChange={(e) => setDollars(e.target.value)}
                className="numeric w-full min-w-0 bg-transparent text-2xl font-semibold text-neutral-900 outline-none placeholder:text-neutral-300"
                placeholder="0"
                aria-label="Amount in dollars"
              />
            </div>
            <div className="mono text-xs text-neutral-400">
              {lamports > 0n && !quote && !quoteError ? (
                "Quoting…"
              ) : tokens > 0n ? (
                <>
                  ≈ <span className="numeric">{tokens.toLocaleString()}</span> {narrative.symbol} for{" "}
                  <span className="numeric">{solIn.toFixed(solIn < 0.01 ? 5 : 3)}</span> SOL
                </>
              ) : (
                "Enter an amount"
              )}
            </div>
          </label>

          <div className="flex items-center gap-1.5">
            {[10, 25, 50, 100].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setDollars(String(v))}
                className={`mono flex-1 rounded py-1 text-xs transition-colors ${
                  dollars === String(v)
                    ? "bg-neutral-200 text-neutral-900"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
                }`}
              >
                ${v}
              </button>
            ))}
            <button
              type="button"
              onClick={setMax}
              className="mono flex-1 rounded bg-neutral-100 py-1 text-xs font-semibold text-neutral-900 hover:bg-neutral-200"
            >
              Max
            </button>
          </div>

          <div className="mono flex items-center justify-between text-xs text-neutral-400">
            <span>
              {solBalance === null
                ? "…"
                : `${solBalance.toFixed(3)} SOL${solUsd ? ` · ${formatUsd(availableUsd)}` : ""} available`}
            </span>
            {tokens > 0n ? (
              <button
                type="button"
                onClick={() => setDetails((v) => !v)}
                className="hover:text-neutral-900"
              >
                {details ? "Hide" : "Details"}
              </button>
            ) : null}
          </div>

          {details && tokens > 0n ? (
            <div className="space-y-1.5 border-t border-neutral-100 pt-3">
              <Line label="You receive" strong>
                {tokens.toLocaleString()} {narrative.symbol}
              </Line>
              <Line label="You pay">
                {solIn.toFixed(solIn < 0.01 ? 5 : 4)} SOL
              </Line>
              <Line label={quote?.route === "jupiter" ? "Swapped via Jupiter" : "Swapped into"}>
                ≈ {formatStock(quote?.stockOut ?? 0n, stock.decimals, 4)} {stock.symbol}
              </Line>
              <Line label="Spent on the curve">
                {formatStock(maxIn, stock.decimals, 6)} {stock.symbol}
              </Line>
              <Line label="Average per token">{formatUsdAuto(toUsd(avgPerToken))}</Line>
              <Line label={`Creator fee ${(narrative.feeBps / 100).toFixed(1)}%`}>
                {formatStock(fee, stock.decimals, 6)} {stock.symbol}
              </Line>
              <Line label="Price impact">
                <span className={impactPct >= 5 ? "text-closing" : ""}>
                  +{impactPct.toFixed(impactPct < 1 ? 2 : 1)}%
                </span>
              </Line>
              {stockBalance > 0n ? (
                <Line label={`${stock.symbol} already held`}>
                  {formatStock(stockBalance, stock.decimals, 4)} {stock.symbol}
                </Line>
              ) : null}
            </div>
          ) : null}

          {quoteError ? (
            <Notice kind="error">{quoteError}</Notice>
          ) : insufficient ? (
            <Notice kind="warning">
              That is more SOL than this wallet holds, after keeping{" "}
              {SOL_RESERVE} SOL for fees. Lower the amount or top up.
            </Notice>
          ) : soldOut ? (
            <Notice kind="warning">
              Sold out. Every token the curve will ever sell has been bought; more come back only
              when someone sells.
            </Notice>
          ) : tokens === 0n && stockIn > 0n ? (
            <p className="text-sm text-neutral-400">
              Minimum one token, which is {formatUsdAuto(toUsd(before))} right now.
            </p>
          ) : null}

          <TxButton
            onClick={buy}
            variant="buy"
            busy={busy}
            signature={signature}
            disabled={tokens === 0n || insufficient || !quote}
            className="w-full"
            size="lg"
          >
            Buy
          </TxButton>
        </>
      ) : (
        <>
          <div className="rounded bg-neutral-100 px-3.5 py-3">
            <div className="mono text-xs text-neutral-400">
              {held.toLocaleString()} {narrative.symbol}
            </div>
            <div className="numeric mt-0.5 text-2xl font-semibold text-neutral-900">
              {formatStock(proceeds, stock.decimals, 4)}{" "}
              <span className="text-base font-medium text-neutral-400">
                {stock.symbol}
              </span>
            </div>
            <div className="mono text-xs text-neutral-400">
              ≈ {formatUsd(toUsd(proceeds))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Line label={`Exit tax ${(narrative.sellTaxBps / 100).toFixed(0)}%`}>
              {formatStock(tax, stock.decimals, 6)} {stock.symbol}
            </Line>
          </div>

          <TxButton
            onClick={sell}
            variant="sell"
            busy={busy}
            signature={signature}
            disabled={!sellAll}
            className="w-full"
            size="lg"
          >
            Sell all
          </TxButton>
          <p className="mono text-[11px] text-neutral-400">
            The exit tax stays in the vault for holders who stay.
          </p>
        </>
      )}

      <Result error={error} signature={signature} />
    </div>
  );
}

export function RedeemPanel({
  narrative,
  position,
  owner,
  stockPrice,
  onDone,
  compact = false,
}: Props & {
  /** Under an automatic payout: just the fallback button. */
  compact?: boolean;
}) {
  const { run, busy, error, signature } = useAction(onDone);
  const held = position?.tokens ?? 0n;
  const stock = narrative.stock;

  const payout = proRata(narrative.finalVault, held, narrative.finalSupply);
  const payoutUsd = (Number(payout) / 10 ** stock.decimals) * stockPrice;

  const redeem = async () => {
    const program = narrative.stockTokenProgram;
    const stockAta = await ataFor(narrative.stockMint, owner, program);
    const tokenAta = await ataFor(
      narrative.narrativeMint,
      owner,
      TOKEN_2022_PROGRAM,
    );

    await run(owner, [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: createNoopSigner(owner),
        ata: stockAta,
        owner,
        mint: narrative.stockMint,
        tokenProgram: program,
      }),
      getRedeemInstruction({
        holder: owner,
        narrative: narrative.address,
        narrativeMint: narrative.narrativeMint,
        holderTokenAccount: tokenAta,
        holderStockAccount: stockAta,
        vault: narrative.vault,
        stockMint: narrative.stockMint,
        stockTokenProgram: program,
      }),
    ]);
  };

  if (compact) {
    return (
      <div className="space-y-3">
        <TxButton
          onClick={redeem}
          variant="ghost"
          busy={busy}
          busyLabel="Converting…"
          signature={signature}
          className="w-full"
          size="sm"
        >
          Not seeing it? Convert now
        </TxButton>
        <Result error={error} signature={signature} />
      </div>
    );
  }

  if (held === 0n) {
    return (
      <Notice>
        You do not hold any ${narrative.symbol}. Holders can convert their tokens
        into {stock.symbol} here; there is no deadline.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      <Panel className="px-3.5 py-3">
        <div className="text-xs text-neutral-400">Your claim</div>
        <div className="numeric mt-0.5 text-2xl font-semibold tracking-tight text-neutral-900">
          {formatStock(payout, stock.decimals, 4)}{" "}
          <span className="text-base font-normal text-neutral-400">
            {stock.symbol}
          </span>
        </div>
        <div className="mt-1 text-xs text-neutral-400">
          {stockPrice > 0 ? `≈ ${formatUsd(payoutUsd)} · ` : ""}
          {held.toLocaleString()} of {narrative.finalSupply.toLocaleString()}{" "}
          tokens
        </div>
      </Panel>

      <TxButton
        onClick={redeem}
        variant="primary"
        busy={busy}
        signature={signature}
        className="w-full"
        size="lg"
      >
        Convert to {stock.symbol}
      </TxButton>

      <p className="text-xs leading-relaxed text-neutral-400">
        Burns all your ${narrative.symbol} and sends the stock to your wallet.
        Your claim does not expire.
      </p>

      <Result error={error} signature={signature} />
    </div>
  );
}
