"use client";

import { useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN, getProgram } from "@/lib/program";
import { formatLamports, tokensOutForSol } from "@/lib/curve";
import { pushActivity } from "@/lib/activity";

type SeasonView = {
  name: string;
  status: string;
  endTs: number;
  supply: bigint;
  base: bigint;
  slope: bigint;
  decimals: number;
  feeBps: number;
  pubkey: PublicKey;
  narrativeMint: PublicKey;
  curveSol: PublicKey;
  index: number;
};

export function BuyBox({
  vault,
  stockMint,
  stockVault,
  marketMaker,
  feeRecipient,
  season,
  onDone,
}: {
  vault: PublicKey;
  stockMint: PublicKey;
  stockVault: PublicKey;
  marketMaker: PublicKey;
  feeRecipient: PublicKey;
  season: SeasonView | null;
  onDone: (sig: string) => void;
}) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [sol, setSol] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!season || season.status !== "live") return null;
    const lamports = BigInt(Math.floor(Number(sol || "0") * 1e9));
    if (lamports <= 0n) return null;
    const fee = (lamports * BigInt(season.feeBps)) / 10_000n;
    const after = lamports - fee;
    const tokens = tokensOutForSol(
      season.base,
      season.slope,
      season.supply,
      after,
      season.decimals
    );
    return { fee, after, tokens };
  }, [sol, season]);

  const live = season?.status === "live" && season.endTs > Date.now() / 1000;

  async function buy() {
    if (!wallet.publicKey || !wallet.signTransaction || !season) return;
    setBusy(true);
    setErr(null);
    try {
      const provider = new AnchorProvider(connection, wallet as never, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const ata = getAssociatedTokenAddressSync(
        season.narrativeMint,
        wallet.publicKey
      );
      const lamports = Math.floor(Number(sol) * 1e9);
      const sig = await program.methods
        .buy(new BN(lamports))
        .accounts({
          buyer: wallet.publicKey,
          vault,
          season: season.pubkey,
          narrativeMint: season.narrativeMint,
          buyerNarrativeAta: ata,
          stockMint,
          stockVaultAta: stockVault,
          marketMakerAta: marketMaker,
          curveSolVault: season.curveSol,
          feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      pushActivity("buy", sig);
      onDone(sig);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-serif text-lg text-paper">Buy the story</h3>
        <span className="font-mono text-xs text-mute">buys only · no sells</span>
      </div>
      {!live ? (
        <p className="text-sm text-mute">
          Trading is closed. Redeem or roll on the season page.
        </p>
      ) : (
        <>
          <label className="block text-xs uppercase tracking-wide text-mute">
            SOL in
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 font-mono text-paper outline-none focus:border-gold"
            value={sol}
            onChange={(e) => setSol(e.target.value)}
            inputMode="decimal"
          />
          {preview && (
            <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs text-mute">
              <dt>tokens out</dt>
              <dd className="text-right text-paper">{preview.tokens.toString()}</dd>
              <dt>fee (1%)</dt>
              <dd className="text-right">{formatLamports(preview.fee)} SOL</dd>
              <dt>into curve</dt>
              <dd className="text-right">{formatLamports(preview.after)} SOL</dd>
            </dl>
          )}
          <button
            disabled={busy || !wallet.connected}
            onClick={buy}
            className="mt-4 w-full rounded-lg bg-gold px-4 py-2.5 font-medium text-ink disabled:opacity-40"
          >
            {busy ? "Buying…" : wallet.connected ? "Buy" : "Connect wallet"}
          </button>
          {err && <p className="mt-2 break-all text-xs text-rust">{err}</p>}
        </>
      )}
    </div>
  );
}
