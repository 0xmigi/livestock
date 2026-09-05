"use client";

/**
 * Buy, sell, and redeem.
 *
 * Each builds instructions with the shared client, has Privy sign the compiled
 * bytes, and broadcasts through the app's own RPC. The buyer's token accounts
 * are created idempotently in the same transaction, so there is never a
 * separate "set up your account" step.
 *
 * Payment is in the stock itself. On mainnet a Jupiter swap belongs at the
 * front of the buy transaction so the user can spend USDC and the program
 * still receives stock; that adapter is not wired yet, so the panel shows the
 * wallet's stock balance and quotes in dollars at the live price.
 */

import { useState } from "react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import {
  applyBps,
  buyCost,
  formatStock,
  netSellProceeds,
  proRata,
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
import { signAndSend, toUserMessage } from "@/lib/tx";
import { Button, Notice, Panel, Segmented } from "./ui";

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

  const run = async (owner: Address, instructions: Instruction[]) => {
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) {
      setError("No Solana wallet connected.");
      return;
    }

    setBusy(true);
    setError(null);
    setSignature(null);

    try {
      const sig = await signAndSend(owner, instructions, async (transaction) => {
        const { signedTransaction } = await signTransaction({
          transaction,
          wallet,
          // Omitting this would silently sign for mainnet.
          chain: SOLANA_CHAIN,
        });
        return signedTransaction;
      });
      setSignature(sig);
      onDone();
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return { run, busy, error, signature };
}

function Result({
  error,
  signature,
}: {
  error: string | null;
  signature: string | null;
}) {
  if (error) return <Notice kind="error">{error}</Notice>;
  if (signature) {
    return (
      <Notice kind="success">
        Confirmed{" "}
        <span className="numeric text-xs opacity-70">
          {signature.slice(0, 16)}…
        </span>
      </Notice>
    );
  }
  return null;
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
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-neutral-400">{label}</span>
      <span
        className={`numeric text-right ${strong ? "font-medium text-neutral-900" : "text-neutral-600"}`}
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
  const { run, busy, error, signature } = useAction(onDone);

  const stock = narrative.stock;
  const params = { basePrice: narrative.basePrice, slope: narrative.slope };
  const toUsd = (units: bigint) =>
    (Number(units) / 10 ** stock.decimals) * stockPrice;

  const usd = Number.parseFloat(dollars);
  const stockIn =
    Number.isFinite(usd) && usd > 0 && stockPrice > 0
      ? usdToStock(usd, stockPrice, stock.decimals)
      : 0n;

  const tokens = tokensForStock(
    narrative.supply,
    stockIn,
    params,
    narrative.feeBps,
  );
  const cost = tokens > 0n ? buyCost(narrative.supply, tokens, params) : 0n;
  const fee = applyBps(cost, narrative.feeBps);
  const maxIn = cost + fee;

  // Price impact: how far your own buy pushes the marginal price.
  const before = spotPrice(narrative.supply, params);
  const after = spotPrice(narrative.supply + tokens, params);
  const impactPct =
    tokens > 0n && before > 0n
      ? (Number(after - before) / Number(before)) * 100
      : 0;
  const avgPerToken = tokens > 0n ? cost / tokens : 0n;

  const stockBalance = position?.stockBalance ?? 0n;
  const insufficient = tokens > 0n && stockBalance < maxIn;

  const held = position?.tokens ?? 0n;
  const sellAll = held > 0n && held <= narrative.supply;
  const proceeds = sellAll
    ? netSellProceeds(narrative.supply, held, params, narrative.sellTaxBps)
    : 0n;
  const tax = sellAll
    ? applyBps(sellRefund(narrative.supply, held, params), narrative.sellTaxBps)
    : 0n;

  const buy = async () => {
    const program = narrative.stockTokenProgram;
    const stockAta = await ataFor(narrative.stockMint, owner, program);
    const tokenAta = await ataFor(
      narrative.narrativeMint,
      owner,
      TOKEN_2022_PROGRAM,
    );
    const creatorFee = await ataFor(narrative.stockMint, narrative.creator, program);

    await run(owner, [
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
    ]);
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

  const availableUsd = toUsd(stockBalance);
  const setMax = () =>
    setDollars(availableUsd > 0 ? (Math.floor(availableUsd * 100) / 100).toString() : "0");

  return (
    <div className="space-y-5">
      {held > 0n ? (
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "buy", label: "Buy" },
            { value: "sell", label: "Sell" },
          ]}
        />
      ) : null}

      {mode === "buy" ? (
        <>
          {/* One big number, as on a trading app. */}
          <label className="block rounded bg-neutral-50 px-5 py-5 focus-within:ring-2 focus-within:ring-neutral-200">
            <div className="flex items-baseline gap-1">
              <span className="numeric text-4xl font-semibold text-neutral-300">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={dollars}
                onChange={(e) => setDollars(e.target.value)}
                className="numeric w-full bg-transparent text-4xl font-semibold text-neutral-900 outline-none placeholder:text-neutral-300"
                placeholder="0"
                aria-label="Amount in dollars"
              />
            </div>
            <div className="mt-1 text-sm text-neutral-400">
              {tokens > 0n ? (
                <>
                  ≈ <span className="numeric">{tokens.toLocaleString()}</span>{" "}
                  ${narrative.symbol}
                </>
              ) : (
                "Enter an amount"
              )}
            </div>
          </label>

          <div className="flex items-center gap-2">
            {[10, 25, 50, 100].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setDollars(String(v))}
                className={`numeric flex-1 rounded py-2 text-sm font-medium transition-colors ${
                  dollars === String(v)
                    ? "bg-neutral-200 text-neutral-900"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
                }`}
              >
                ${v}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="numeric text-neutral-400">
              {formatStock(stockBalance, stock.decimals, 4)} {stock.symbol}{" "}
              available
              {stockPrice > 0 ? ` · ≈ ${formatUsd(availableUsd)}` : ""}
            </span>
            <button
              type="button"
              onClick={setMax}
              className="font-semibold text-neutral-900 hover:underline"
            >
              Max
            </button>
          </div>

          {tokens > 0n ? (
            <div className="space-y-2 border-t border-neutral-100 pt-4">
              <Line label="You receive" strong>
                {tokens.toLocaleString()} ${narrative.symbol}
              </Line>
              <Line label="Paid in stock">
                {formatStock(maxIn, stock.decimals, 6)} {stock.symbol}
              </Line>
              <Line label="Average per token">
                {formatUsdAuto(toUsd(avgPerToken))}
              </Line>
              <Line label={`Creator fee ${(narrative.feeBps / 100).toFixed(1)}%`}>
                {formatStock(fee, stock.decimals, 6)} {stock.symbol}
              </Line>
              <Line label="Price impact">
                <span className={impactPct >= 5 ? "text-accent" : ""}>
                  +{impactPct.toFixed(impactPct < 1 ? 2 : 1)}%
                </span>
              </Line>
            </div>
          ) : null}

          {insufficient ? (
            <Notice kind="warning">
              You need {formatStock(maxIn, stock.decimals, 4)} {stock.symbol} in
              this wallet for that buy. Lower the amount or top up {stock.symbol}.
            </Notice>
          ) : tokens === 0n && stockIn > 0n ? (
            <p className="text-sm text-neutral-400">
              Minimum one token. The curve starts at{" "}
              {formatStock(narrative.basePrice, stock.decimals, 6)} {stock.symbol}{" "}
              (≈ {formatUsdAuto(toUsd(narrative.basePrice))}).
            </p>
          ) : null}

          <Button
            onClick={buy}
            disabled={busy || tokens === 0n || insufficient}
            className="w-full !py-3.5 !text-base"
            size="lg"
          >
            {busy ? "Confirming…" : `Buy $${narrative.symbol}`}
          </Button>

          <p className="text-center text-xs leading-relaxed text-neutral-400">
            Converts into {stock.symbol} at expiry. Nothing to sell, no exit to
            time.
          </p>
        </>
      ) : (
        <>
          <div className="rounded bg-neutral-50 px-5 py-5">
            <div className="text-sm text-neutral-400">
              Sell all {held.toLocaleString()} ${narrative.symbol}
            </div>
            <div className="numeric mt-1 text-4xl font-semibold text-neutral-900">
              {formatStock(proceeds, stock.decimals, 4)}{" "}
              <span className="text-lg font-medium text-neutral-400">
                {stock.symbol}
              </span>
            </div>
            <div className="mt-1 text-sm text-neutral-400">
              ≈ {formatUsd(toUsd(proceeds))}
            </div>
          </div>

          <div className="space-y-2">
            <Line label={`Exit tax ${(narrative.sellTaxBps / 100).toFixed(0)}%`}>
              {formatStock(tax, stock.decimals, 6)} {stock.symbol}
            </Line>
          </div>

          <Button
            onClick={sell}
            variant="outline"
            disabled={busy || !sellAll}
            className="w-full !py-3.5 !text-base"
            size="lg"
          >
            {busy ? "Confirming…" : "Sell everything"}
          </Button>

          <p className="text-center text-xs leading-relaxed text-neutral-400">
            The exit tax stays in the vault for the holders who stay to expiry.
            Holding costs you nothing.
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
}: Props) {
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
      <Panel className="rounded px-5 py-5">
        <div className="text-xs uppercase tracking-widest text-neutral-400">
          Your claim
        </div>
        <div className="numeric mt-1.5 text-4xl font-semibold tracking-tight text-neutral-900">
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

      <Button
        onClick={redeem}
        disabled={busy}
        className="w-full !py-3.5 !text-base"
        size="lg"
      >
        {busy ? "Confirming…" : `Convert to ${stock.symbol}`}
      </Button>

      <p className="text-xs leading-relaxed text-neutral-400">
        Burns all your ${narrative.symbol} and sends the stock to your wallet.
        Your claim does not expire.
      </p>

      <Result error={error} signature={signature} />
    </div>
  );
}
