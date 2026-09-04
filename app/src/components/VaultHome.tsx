"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  STOCK_MINT,
  dummyProvider,
  getProgram,
  marketMakerPda,
  seasonPda,
  stockVaultPda,
  vaultPda,
} from "@/lib/program";
import { formatStock } from "@/lib/curve";
import { Countdown } from "./Countdown";
import { BuyBox } from "./BuyBox";
import Link from "next/link";

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

function statusKey(status: unknown): string {
  if (status && typeof status === "object") {
    return Object.keys(status as object)[0] ?? "unknown";
  }
  return String(status);
}

export function VaultHome() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [vaultStock, setVaultStock] = useState<bigint>(0n);
  const [season, setSeason] = useState<SeasonView | null>(null);
  const [authority, setAuthority] = useState<PublicKey | null>(null);
  const [vault, setVault] = useState<PublicKey | null>(null);
  const [stockVault, setStockVault] = useState<PublicKey | null>(null);
  const [marketMaker, setMarketMaker] = useState<PublicKey | null>(null);
  const [userNarrative, setUserNarrative] = useState<bigint>(0n);

  const load = useCallback(async () => {
    setError(null);
    if (!STOCK_MINT) {
      setError("No stock mint in env. Run setup or create a vault on /admin.");
      return;
    }
    const [v] = vaultPda(STOCK_MINT);
    const [sv] = stockVaultPda(STOCK_MINT);
    const [mm] = marketMakerPda(STOCK_MINT);
    setVault(v);
    setStockVault(sv);
    setMarketMaker(mm);
    const program = getProgram(dummyProvider(connection));
    try {
      const vaultAcc = await program.account.vault.fetch(v);
      setAuthority(vaultAcc.authority as PublicKey);
      const ata = await getAccount(connection, sv);
      setVaultStock(ata.amount);
      const live = vaultAcc.liveSeason as PublicKey;
      if (!live.equals(PublicKey.default)) {
        const s = await program.account.season.fetch(live);
        setSeason({
          name: s.name as string,
          status: statusKey(s.status),
          endTs: Number(s.endTs),
          supply: BigInt(s.narrativeSupply.toString()),
          base: BigInt(s.base.toString()),
          slope: BigInt(s.slope.toString()),
          decimals: s.decimals as number,
          feeBps: s.feeBps as number,
          pubkey: live,
          narrativeMint: s.narrativeMint as PublicKey,
          curveSol: s.curveSolVault as PublicKey,
          index: s.index as number,
        });
        if (publicKey) {
          try {
            const nAta = getAssociatedTokenAddressSync(
              s.narrativeMint as PublicKey,
              publicKey
            );
            const nAcc = await getAccount(connection, nAta);
            setUserNarrative(nAcc.amount);
          } catch {
            setUserNarrative(0n);
          }
        }
      } else {
        // fall back to last created season if any
        const idx = (vaultAcc.seasonIndex as number) - 1;
        if (idx >= 0) {
          const [last] = seasonPda(v, idx);
          const s = await program.account.season.fetch(last);
          setSeason({
            name: s.name as string,
            status: statusKey(s.status),
            endTs: Number(s.endTs),
            supply: BigInt(s.narrativeSupply.toString()),
            base: BigInt(s.base.toString()),
            slope: BigInt(s.slope.toString()),
            decimals: s.decimals as number,
            feeBps: s.feeBps as number,
            pubkey: last,
            narrativeMint: s.narrativeMint as PublicKey,
            curveSol: s.curveSolVault as PublicKey,
            index: s.index as number,
          });
        } else {
          setSeason(null);
        }
      }
    } catch (e: unknown) {
      setError(
        "Vault not found on this cluster. Use /admin to init, or run `npm run setup`."
      );
      console.error(e);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">TSLAx · mock Tesla</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-paper">
        {season?.name ?? "No live season"}
      </h1>
      <p className="mt-3 max-w-md text-mute">
        Buy the story. When the season ends, redeem the stock or roll into the next
        one.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-xs uppercase tracking-wide text-mute">Vault TSLAx</div>
          <div className="mt-1 font-mono text-2xl text-paper">
            {formatStock(vaultStock)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 p-4">
          <div className="text-xs uppercase tracking-wide text-mute">
            {season ? "Ends in" : "Status"}
          </div>
          <div className="mt-1 text-2xl">
            {season ? (
              <Countdown endTs={season.endTs} />
            ) : (
              <span className="text-mute">—</span>
            )}
          </div>
        </div>
      </div>

      {season && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-xs ${
              season.status === "live"
                ? "bg-moss/20 text-moss"
                : "bg-rust/20 text-rust"
            }`}
          >
            {season.status}
          </span>
          <span className="font-mono text-mute">
            supply {season.supply.toString()}
          </span>
          {publicKey && (
            <span className="font-mono text-mute">
              you {userNarrative.toString()}
            </span>
          )}
        </div>
      )}

      <div className="mt-8">
        {vault && stockVault && marketMaker && authority && (
          <BuyBox
            vault={vault}
            stockMint={STOCK_MINT!}
            stockVault={stockVault}
            marketMaker={marketMaker}
            feeRecipient={authority}
            season={season}
            onDone={() => void load()}
          />
        )}
      </div>

      {error && <p className="mt-4 text-sm text-rust">{error}</p>}

      <p className="mt-8 text-sm text-mute">
        After close,{" "}
        <Link href="/season" className="text-gold underline">
          redeem or roll
        </Link>
        .
      </p>
    </main>
  );
}
