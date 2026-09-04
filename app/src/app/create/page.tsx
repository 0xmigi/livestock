"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import {
  findNarrative,
  findNarrativeMint,
  findVault,
  formatStock,
  getCreateNarrativeInstruction,
  usdToStock,
} from "@nm/client";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import { createNoopSigner } from "@solana/kit";

import {
  Button,
  Card,
  Field,
  Notice,
  Shell,
  inputClass,
} from "@/components/ui";
import { ConnectButton, useOwner } from "@/components/wallet";
import {
  formatUsd,
  SOLANA_CHAIN,
  STOCK_DECIMALS,
  STOCK_MINT,
  STOCK_SYMBOL,
} from "@/lib/config";
import { fetchStockTokenProgram } from "@/lib/narratives";
import { useStockPrice } from "@/lib/price";
import { signAndSend, toUserMessage } from "@/lib/tx";

const DURATIONS = [
  { label: "1 week", secs: 7 * 24 * 3600 },
  { label: "2 weeks", secs: 14 * 24 * 3600 },
  { label: "1 month", secs: 30 * 24 * 3600 },
];

/** 10% is the tuning dial that decides whether people hold to expiry. */
const SELL_TAX_BPS = 1_000;
const FEE_BPS = 100;

export default function Create() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const owner = useOwner();
  const { price } = useStockPrice();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].secs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Curve defaults derived from the stock's price so the first token lands
  // near $0.10 and reaches roughly $10 by a million tokens, whatever the
  // stock happens to trade at.
  const basePrice = usdToStock(0.1, price, STOCK_DECIMALS);
  const slope =
    (usdToStock(10, price, STOCK_DECIMALS) - basePrice) / 1_000_000n;

  const valid =
    name.trim().length > 0 &&
    name.length <= 32 &&
    symbol.trim().length > 0 &&
    symbol.length <= 10 &&
    basePrice > 0n &&
    slope > 0n;

  const create = async () => {
    if (!owner || !STOCK_MINT) return;
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) {
      setError("No Solana wallet connected.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const cleanName = name.trim();
      // Read the stock's token program off its mint: tokenized stocks are
      // Token-2022 while most mints are classic SPL, and the two derive
      // different associated token addresses.
      const stockTokenProgram = await fetchStockTokenProgram(STOCK_MINT);

      const [narrative] = await findNarrative(STOCK_MINT, owner, cleanName);
      const [narrativeMint] = await findNarrativeMint(narrative);
      const [vault] = await findVault(
        narrative,
        STOCK_MINT,
        stockTokenProgram,
      );

      const expiryTs = BigInt(Math.floor(Date.now() / 1000) + duration);

      const instructions = [
        // The program pins whatever vault it is handed rather than allocating
        // one, so it must exist by the time create_narrative runs.
        getCreateAssociatedTokenIdempotentInstruction({
          payer: createNoopSigner(owner),
          ata: vault,
          owner: narrative,
          mint: STOCK_MINT,
          tokenProgram: stockTokenProgram,
        }),
        getCreateNarrativeInstruction({
          creator: owner,
          narrative,
          stockMint: STOCK_MINT,
          narrativeMint,
          vault,
          stockTokenProgram,
          name: cleanName,
          symbol: symbol.trim().toUpperCase(),
          expiryTs,
          basePrice,
          slope,
          feeBps: FEE_BPS,
          sellTaxBps: SELL_TAX_BPS,
        }),
      ];

      await signAndSend(owner, instructions, async (transaction) => {
        const { signedTransaction } = await signTransaction({
          transaction,
          wallet,
          chain: SOLANA_CHAIN,
        });
        return signedTransaction;
      });
      router.push(`/n/${narrative}`);
    } catch (cause) {
      setError(toUserMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Shell action={<ConnectButton />}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Create a narrative
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            Name one thing you think is about to happen, and set the date it
            resolves into {STOCK_SYMBOL}.
          </p>
        </div>

        {!STOCK_MINT ? (
          <Notice kind="error">
            Set <code>NEXT_PUBLIC_STOCK_MINT</code> before creating.
          </Notice>
        ) : null}

        <Card className="space-y-5">
          <Field label="Name" hint="What is the story? Up to 32 characters.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              className={inputClass}
              placeholder="Robotaxi Austin"
            />
          </Field>

          <Field label="Ticker" hint="Up to 10 characters.">
            <input
              value={symbol}
              onChange={(e) =>
                setSymbol(e.target.value.toUpperCase().slice(0, 10))
              }
              className={`${inputClass} numeric`}
              placeholder="RBTX"
            />
          </Field>

          <Field
            label="Expires in"
            hint="Fixed at creation. Nobody can move it afterwards, including you."
          >
            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  onClick={() => setDuration(d.secs)}
                  className={`flex-1 rounded-full px-3 py-2.5 text-sm font-medium transition-colors ${
                    duration === d.secs
                      ? "bg-ink text-white"
                      : "bg-fill text-ink-soft hover:bg-rule"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="space-y-1.5 border-t border-rule pt-4 text-xs text-ink-faint">
            <div className="flex justify-between">
              <span>Starting price</span>
              <span className="numeric">
                {formatStock(basePrice, STOCK_DECIMALS, 6)} {STOCK_SYMBOL} ≈{" "}
                {formatUsd(0.1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Your fee on every buy</span>
              <span className="numeric">{FEE_BPS / 100}%</span>
            </div>
            <div className="flex justify-between">
              <span>Exit tax, paid to holders who stay</span>
              <span className="numeric">{SELL_TAX_BPS / 100}%</span>
            </div>
          </div>
        </Card>

        {!ready ? null : !authenticated || !owner ? (
          <Button onClick={login} className="w-full">
            Connect to create
          </Button>
        ) : (
          <Button
            onClick={create}
            disabled={busy || !valid || !STOCK_MINT}
            className="w-full"
          >
            {busy ? "Creating…" : "Launch narrative"}
          </Button>
        )}

        {error ? <Notice kind="error">{error}</Notice> : null}
      </div>
    </Shell>
  );
}
