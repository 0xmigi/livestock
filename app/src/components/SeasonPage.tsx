"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  STOCK_MINT,
  dummyProvider,
  getProgram,
  marketMakerPda,
  positionPda,
  seasonPda,
  stockVaultPda,
  vaultPda,
} from "@/lib/program";
import { formatStock } from "@/lib/curve";
import { Countdown } from "@/components/Countdown";
import { BuyBox } from "@/components/BuyBox";
import { pushActivity, readActivity, type Activity } from "@/lib/activity";

function statusKey(status: unknown): string {
  if (status && typeof status === "object") {
    return Object.keys(status as object)[0] ?? "unknown";
  }
  return String(status);
}

export function SeasonPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [data, setData] = useState<{
    vault: PublicKey;
    stockVault: PublicKey;
    marketMaker: PublicKey;
    authority: PublicKey;
    season: PublicKey;
    redeemSeason: PublicKey;
    nextSeason: PublicKey | null;
    name: string;
    status: string;
    redeemStatus: string;
    endTs: number;
    supply: bigint;
    remaining: bigint;
    narrativeMint: PublicKey;
    redeemMint: PublicKey;
    nextNarrativeMint: PublicKey | null;
    curveSol: PublicKey;
    index: number;
    vaultStock: bigint;
    userNarrative: bigint;
    userStock: bigint;
    userNext: bigint;
    base: bigint;
    slope: bigint;
    decimals: number;
    feeBps: number;
  } | null>(null);

  const load = useCallback(async () => {
    setActivity(readActivity());
    if (!STOCK_MINT) return;
    const [v] = vaultPda(STOCK_MINT);
    const [sv] = stockVaultPda(STOCK_MINT);
    const [mm] = marketMakerPda(STOCK_MINT);
    const program = getProgram(dummyProvider(connection));
    const vaultAcc = await program.account.vault.fetch(v);
    const lastCreated = (vaultAcc.seasonIndex as number) - 1;
    if (lastCreated < 0) {
      setData(null);
      return;
    }
    const live = vaultAcc.liveSeason as PublicKey;
    const seasonPk = live.equals(PublicKey.default)
      ? seasonPda(v, lastCreated)[0]
      : live;
    const s = await program.account.season.fetch(seasonPk);
    const index = s.index as number;

    // Redeem/roll target: the latest closed season. That may be the previous
    // one if a new season is already live.
    let redeemSeason = seasonPk;
    let redeemMint = s.narrativeMint as PublicKey;
    let redeemStatus = statusKey(s.status);
    if (redeemStatus === "live" && index > 0) {
      try {
        const [prev] = seasonPda(v, index - 1);
        const prevAcc = await program.account.season.fetch(prev);
        if (statusKey(prevAcc.status) === "closed") {
          redeemSeason = prev;
          redeemMint = prevAcc.narrativeMint as PublicKey;
          redeemStatus = "closed";
        }
      } catch {
        /* no previous */
      }
    }

    let nextSeason: PublicKey | null = null;
    let nextNarrativeMint: PublicKey | null = null;
    try {
      const closedIndex =
        redeemStatus === "closed"
          ? (await program.account.season.fetch(redeemSeason)).index
          : index;
      const [ns] = seasonPda(v, (closedIndex as number) + 1);
      const nsAcc = await program.account.season.fetch(ns);
      nextSeason = ns;
      nextNarrativeMint = nsAcc.narrativeMint as PublicKey;
    } catch {
      /* next season not created yet */
    }

    const ata = await getAccount(connection, sv);
    let userNarrative = 0n;
    let userStock = 0n;
    let userNext = 0n;
    if (wallet.publicKey) {
      try {
        userNarrative = (
          await getAccount(
            connection,
            getAssociatedTokenAddressSync(redeemMint, wallet.publicKey)
          )
        ).amount;
      } catch {
        /* empty */
      }
      try {
        userStock = (
          await getAccount(
            connection,
            getAssociatedTokenAddressSync(STOCK_MINT, wallet.publicKey)
          )
        ).amount;
      } catch {
        /* empty */
      }
      if (nextNarrativeMint) {
        try {
          userNext = (
            await getAccount(
              connection,
              getAssociatedTokenAddressSync(nextNarrativeMint, wallet.publicKey)
            )
          ).amount;
        } catch {
          /* empty */
        }
      }
    }

    setData({
      vault: v,
      stockVault: sv,
      marketMaker: mm,
      authority: vaultAcc.authority as PublicKey,
      season: seasonPk,
      redeemSeason,
      nextSeason,
      name: s.name as string,
      status: statusKey(s.status),
      redeemStatus,
      endTs: Number(s.endTs),
      supply: BigInt(s.narrativeSupply.toString()),
      remaining: BigInt(s.remainingSupply.toString()),
      narrativeMint: s.narrativeMint as PublicKey,
      redeemMint,
      nextNarrativeMint,
      curveSol: s.curveSolVault as PublicKey,
      index,
      vaultStock: ata.amount,
      userNarrative,
      userStock,
      userNext,
      base: BigInt(s.base.toString()),
      slope: BigInt(s.slope.toString()),
      decimals: s.decimals as number,
      feeBps: s.feeBps as number,
    });
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    void load().catch((e) => setMsg(String(e)));
  }, [load]);

  async function redeem() {
    if (!wallet.publicKey || !data) return;
    setBusy(true);
    setMsg(null);
    try {
      const provider = new AnchorProvider(connection, wallet as never, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const [position] = positionPda(data.redeemSeason, wallet.publicKey);
      const sig = await program.methods
        .redeem()
        .accounts({
          owner: wallet.publicKey,
          vault: data.vault,
          season: data.redeemSeason,
          position,
          narrativeMint: data.redeemMint,
          ownerNarrativeAta: getAssociatedTokenAddressSync(
            data.redeemMint,
            wallet.publicKey
          ),
          stockMint: STOCK_MINT!,
          stockVaultAta: data.stockVault,
          ownerStockAta: getAssociatedTokenAddressSync(STOCK_MINT!, wallet.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      pushActivity("redeem", sig);
      await load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function roll() {
    if (!wallet.publicKey || !data?.nextSeason || !data.nextNarrativeMint) return;
    setBusy(true);
    setMsg(null);
    try {
      const provider = new AnchorProvider(connection, wallet as never, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const [position] = positionPda(data.redeemSeason, wallet.publicKey);
      const sig = await program.methods
        .roll()
        .accounts({
          owner: wallet.publicKey,
          vault: data.vault,
          season: data.redeemSeason,
          nextSeason: data.nextSeason,
          position,
          narrativeMint: data.redeemMint,
          nextNarrativeMint: data.nextNarrativeMint,
          ownerNarrativeAta: getAssociatedTokenAddressSync(
            data.redeemMint,
            wallet.publicKey
          ),
          ownerNextNarrativeAta: getAssociatedTokenAddressSync(
            data.nextNarrativeMint,
            wallet.publicKey
          ),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      pushActivity("roll", sig);
      await load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const closed = data && (data.redeemStatus === "closed" || data.redeemStatus === "settled");
  const live = data?.status === "live";

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">Season ticket</p>
      <h1 className="mt-2 font-serif text-4xl text-paper">
        {data?.name ?? "—"}
      </h1>
      {data && (
        <div className="mt-3 flex items-center gap-3">
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-xs ${
              live ? "bg-moss/20 text-moss" : "bg-rust/20 text-rust"
            }`}
          >
            {data.status}
          </span>
          {live && (
            <span className="text-sm text-mute">
              ends <Countdown endTs={data.endTs} />
            </span>
          )}
        </div>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-3 font-mono text-sm">
        <div className="rounded-xl border border-white/10 p-3">
          <dt className="text-xs text-mute">Your narrative</dt>
          <dd className="mt-1 text-paper">{data?.userNarrative.toString() ?? "0"}</dd>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <dt className="text-xs text-mute">Your TSLAx</dt>
          <dd className="mt-1 text-paper">
            {data ? formatStock(data.userStock) : "0"}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <dt className="text-xs text-mute">Vault TSLAx</dt>
          <dd className="mt-1 text-paper">
            {data ? formatStock(data.vaultStock) : "0"}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <dt className="text-xs text-mute">Season-2 tokens</dt>
          <dd className="mt-1 text-paper">{data?.userNext.toString() ?? "0"}</dd>
        </div>
      </dl>

      {data && live && (
        <div className="mt-8">
          <BuyBox
            vault={data.vault}
            stockMint={STOCK_MINT!}
            stockVault={data.stockVault}
            marketMaker={data.marketMaker}
            feeRecipient={data.authority}
            season={{
              name: data.name,
              status: data.status,
              endTs: data.endTs,
              supply: data.supply,
              base: data.base,
              slope: data.slope,
              decimals: data.decimals,
              feeBps: data.feeBps,
              pubkey: data.season,
              narrativeMint: data.narrativeMint,
              curveSol: data.curveSol,
              index: data.index,
            }}
            onDone={() => void load()}
          />
        </div>
      )}

      {closed && (
        <div className="mt-8 grid grid-cols-2 gap-3">
          <button
            disabled={busy || !wallet.connected}
            onClick={redeem}
            className="rounded-lg bg-paper px-4 py-3 font-medium text-ink disabled:opacity-40"
          >
            Redeem stock
          </button>
          <button
            disabled={busy || !wallet.connected || !data?.nextSeason}
            onClick={roll}
            className="rounded-lg border border-gold px-4 py-3 font-medium text-gold disabled:opacity-40"
          >
            Roll into next
          </button>
          {!data?.nextSeason && (
            <p className="col-span-2 text-xs text-mute">
              Roll needs season N+1. Create it on /admin after close.
            </p>
          )}
        </div>
      )}

      {msg && <p className="mt-4 break-all text-xs text-rust">{msg}</p>}

      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-wide text-mute">Activity</h2>
        <ul className="mt-2 space-y-1 font-mono text-xs text-mute">
          {activity.length === 0 && <li>No local transactions yet.</li>}
          {activity.map((a) => (
            <li key={a.sig} className="truncate">
              {a.action} · {a.sig}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
