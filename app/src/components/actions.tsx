"use client";

/**
 * Buy, sell, and redeem.
 *
 * Each builds instructions with the shared client, has Privy sign the compiled
 * bytes, and broadcasts through the app's own RPC. The buyer's stock account is
 * created idempotently in the same transaction, so there is never a separate
 * "set up your account" step.
 *
 * On mainnet a Jupiter swap belongs at the front of the buy transaction, so the
 * user spends USDC and the program still receives stock. That adapter is the
 * one piece not wired here yet — see `SWAP` below.
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
  SOLANA_CHAIN,
  STOCK_DECIMALS,
  STOCK_SYMBOL,
  TOKEN_2022_PROGRAM,
} from "@/lib/config";
import type { NarrativeRow, Position } from "@/lib/narratives";
import { signAndSend, toUserMessage } from "@/lib/tx";
import { Button, Field, Notice, inputClass } from "./ui";

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

  const params = { basePrice: narrative.basePrice, slope: narrative.slope };
  const usd = Number.parseFloat(dollars);
  const stockIn =
    Number.isFinite(usd) && usd > 0
      ? usdToStock(usd, stockPrice, STOCK_DECIMALS)
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

  const held = position?.tokens ?? 0n;
  const sellAll = held > 0n && held <= narrative.supply;
  const proceeds = sellAll
    ? netSellProceeds(narrative.supply, held, params, narrative.sellTaxBps)
    : 0n;
  const tax = sellAll
    ? applyBps(sellRefund(narrative.supply, held, params), narrative.sellTaxBps)
    : 0n;

  const buy = async () => {
    const stock = narrative.stockTokenProgram;
    const stockAta = await ataFor(narrative.stockMint, owner, stock);
    const tokenAta = await ataFor(
      narrative.narrativeMint,
      owner,
      TOKEN_2022_PROGRAM,
    );
    const creatorFee = await ataFor(narrative.stockMint, narrative.creator, stock);

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
        tokenProgram: stock,
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
        stockTokenProgram: stock,
        tokensOut: tokens,
        maxStockIn: maxIn,
      }),
    ]);
  };

  const sell = async () => {
    const stock = narrative.stockTokenProgram;
    const stockAta = await ataFor(narrative.stockMint, owner, stock);
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
        tokenProgram: stock,
      }),
      getSellInstruction({
        seller: owner,
        narrative: narrative.address,
        narrativeMint: narrative.narrativeMint,
        sellerTokenAccount: tokenAta,
        sellerStockAccount: stockAta,
        vault: narrative.vault,
        stockMint: narrative.stockMint,
        stockTokenProgram: stock,
        tokensIn: held,
        minStockOut: 0n,
      }),
    ]);
  };

  return (
    <div className="space-y-5">
      {held > 0n ? (
        <div className="flex gap-1 rounded-full bg-fill p-1 text-sm">
          {(["buy", "sell"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-full py-2 font-medium capitalize transition-colors ${
                mode === m
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink-faint"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "buy" ? (
        <>
          <Field label="You pay">
            <div className="flex items-center gap-2 rounded-xl border border-rule bg-white px-4 py-3">
              <span className="text-2xl font-medium text-ink-faint">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={dollars}
                onChange={(e) => setDollars(e.target.value)}
                className="numeric w-full bg-transparent text-2xl font-medium outline-none"
                placeholder="0"
              />
            </div>
          </Field>

          <div className="flex items-baseline justify-between rounded-xl bg-fill px-4 py-3.5">
            <span className="text-sm text-ink-soft">You receive</span>
            <span className="numeric text-lg font-medium">
              {tokens.toLocaleString()}{" "}
              <span className="text-sm font-normal text-ink-faint">
                {narrative.symbol}
              </span>
            </span>
          </div>

          <p className="text-xs leading-relaxed text-ink-faint">
            {tokens > 0n ? (
              <>
                Costs {formatStock(maxIn, STOCK_DECIMALS)} {STOCK_SYMBOL},
                including a {(narrative.feeBps / 100).toFixed(2)}% creator fee.
                At expiry these convert into {STOCK_SYMBOL}.
              </>
            ) : (
              <>
                Minimum one token — the curve starts at{" "}
                {formatStock(narrative.basePrice, STOCK_DECIMALS, 6)}{" "}
                {STOCK_SYMBOL}.
              </>
            )}
          </p>

          <Button
            onClick={buy}
            disabled={busy || tokens === 0n}
            className="w-full"
          >
            {busy ? "Confirming…" : `Buy ${narrative.symbol}`}
          </Button>
        </>
      ) : (
        <>
          <div className="rounded-xl bg-fill px-4 py-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-soft">
                Sell all {held.toLocaleString()}
              </span>
              <span className="numeric text-lg font-medium">
                {formatStock(proceeds, STOCK_DECIMALS)}{" "}
                <span className="text-sm font-normal text-ink-faint">
                  {STOCK_SYMBOL}
                </span>
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-faint">
            A {(narrative.sellTaxBps / 100).toFixed(0)}% exit tax of{" "}
            {formatStock(tax, STOCK_DECIMALS)} {STOCK_SYMBOL} stays in the
            vault for the holders who stay to expiry. Holding costs you nothing.
          </p>

          <Button
            onClick={sell}
            variant="secondary"
            disabled={busy || !sellAll}
            className="w-full"
          >
            {busy ? "Confirming…" : "Sell everything"}
          </Button>
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

  const payout = proRata(narrative.finalVault, held, narrative.finalSupply);
  const payoutUsd =
    (Number(payout) / 10 ** STOCK_DECIMALS) * stockPrice;

  const redeem = async () => {
    const stock = narrative.stockTokenProgram;
    const stockAta = await ataFor(narrative.stockMint, owner, stock);
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
        tokenProgram: stock,
      }),
      getRedeemInstruction({
        holder: owner,
        narrative: narrative.address,
        narrativeMint: narrative.narrativeMint,
        holderTokenAccount: tokenAta,
        holderStockAccount: stockAta,
        vault: narrative.vault,
        stockMint: narrative.stockMint,
        stockTokenProgram: stock,
      }),
    ]);
  };

  if (held === 0n) {
    return (
      <Notice>
        You do not hold any {narrative.symbol}. This narrative has settled.
      </Notice>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-fill px-4 py-4">
        <div className="label">Your claim</div>
        <div className="numeric mt-1.5 text-3xl font-medium tracking-tight">
          {formatStock(payout, STOCK_DECIMALS)}{" "}
          <span className="text-base font-normal text-ink-faint">
            {STOCK_SYMBOL}
          </span>
        </div>
        <div className="mt-1 text-xs text-ink-faint">
          ≈ {formatUsd(payoutUsd)} · {held.toLocaleString()} of{" "}
          {narrative.finalSupply.toLocaleString()} tokens
        </div>
      </div>

      <Button onClick={redeem} disabled={busy} className="w-full">
        {busy ? "Confirming…" : `Convert to ${STOCK_SYMBOL}`}
      </Button>

      <p className="text-xs leading-relaxed text-ink-faint">
        Burns all your {narrative.symbol} and sends you the stock. There is no
        deadline — your claim does not expire.
      </p>

      <Result error={error} signature={signature} />
    </div>
  );
}
