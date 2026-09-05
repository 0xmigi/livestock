"use client";

/**
 * 24-hour activity for a narrative, with no indexer.
 *
 * Every buy and sell touches the narrative account, so its signature history
 * is the trade history. From the last 24 hours of it:
 *  - tokens minted or burned give yesterday's supply, and the curve gives
 *    yesterday's price, hence the price change;
 *  - the vault's balance moves give the volume, in the underlying;
 *  - the sign of each supply move says whether it was a buy or a sell.
 *
 * In dollar terms the underlying moved too, so its own 24h change (from the
 * price feed, when it has one) is folded into the price change.
 */

import { useEffect, useState } from "react";
import { spotPrice, type Narrative } from "@nm/client";
import type { Address, Signature } from "@solana/kit";

import { rpc } from "./config";
import { useStockChanges } from "./price";

const DAY = 24 * 3600;
const MAX_TXS = 300;

export type Activity = {
  /** Supply 24h ago, or null when the history is too long to be sure. */
  supplyThen: bigint | null;
  /** Underlying moved through the vault in 24h, in base units. */
  volume: bigint;
  buys: number;
  sells: number;
};

const cache = new Map<string, Promise<Activity>>();

async function scan(narrative: Address, n: Narrative): Promise<Activity> {
  const since = Math.floor(Date.now() / 1000) - DAY;
  const sigs = await rpc.getSignaturesForAddress(narrative, { limit: MAX_TXS }).send();
  const recent = sigs.filter(
    (s) => !s.err && s.blockTime !== null && s.blockTime !== undefined && Number(s.blockTime) >= since,
  );
  const empty = { supplyThen: n.supply, volume: 0n, buys: 0, sells: 0 };
  if (recent.length === 0) return empty;
  const truncated = sigs.length >= MAX_TXS && recent.length === sigs.length;

  let minted = 0n;
  let volume = 0n;
  let buys = 0;
  let sells = 0;
  const txs = await Promise.all(
    recent.map((s) =>
      rpc
        .getTransaction(s.signature as Signature, { maxSupportedTransactionVersion: 0, encoding: "json" })
        .send()
        .catch(() => null),
    ),
  );
  for (const tx of txs) {
    const meta = tx?.meta;
    if (!meta) continue;
    const pre = new Map<number, bigint>();
    const preVault = new Map<number, bigint>();
    for (const b of meta.preTokenBalances ?? []) {
      if (b.mint === n.narrativeMint) pre.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
      if (b.mint === n.stockMint && b.owner === narrative) preVault.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
    }
    let supplyDelta = 0n;
    const seen = new Set<number>();
    for (const b of meta.postTokenBalances ?? []) {
      if (b.mint === n.narrativeMint) {
        seen.add(b.accountIndex);
        supplyDelta += BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
      }
      if (b.mint === n.stockMint && b.owner === narrative) {
        const d = BigInt(b.uiTokenAmount.amount) - (preVault.get(b.accountIndex) ?? 0n);
        volume += d < 0n ? -d : d;
      }
    }
    for (const [index, amount] of pre) if (!seen.has(index)) supplyDelta -= amount;
    minted += supplyDelta;
    if (supplyDelta > 0n) buys++;
    else if (supplyDelta < 0n) sells++;
  }
  const then = n.supply - minted;
  return { supplyThen: truncated ? null : then < 0n ? 0n : then, volume, buys, sells };
}

function load(address: Address, n: Narrative): Promise<Activity> {
  // Keyed on supply too: every buy or sell changes it, so a trade that just
  // landed is never hidden behind a cached scan from before it.
  const key = `${address}:${n.supply}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = scan(address, n).catch(() => ({ supplyThen: null, volume: 0n, buys: 0, sells: 0 }));
  cache.set(key, p);
  setTimeout(() => cache.delete(key), 60_000);
  return p;
}

/** The last 24 hours, or null while loading. */
export function useActivity(address: Address | null, n: Narrative | null): Activity | null {
  const [activity, setActivity] = useState<Activity | null>(null);
  useEffect(() => {
    if (!address || !n) return;
    let cancelled = false;
    void load(address, n).then((a) => {
      if (!cancelled) setActivity(a);
    });
    return () => {
      cancelled = true;
    };
  }, [address, n?.supply, n?.narrativeMint]); // eslint-disable-line react-hooks/exhaustive-deps
  return activity;
}

export type Change = { pct: number; inStockTerms: boolean } | null;

/**
 * Percent change in the token's dollar price over 24h, or null while
 * loading or when it cannot be known. `inStockTerms` is true when the
 * underlying's own move is unknown and the figure is in the underlying.
 */
export function usePriceChange(address: Address | null, n: Narrative | null): Change {
  const activity = useActivity(address, n);
  const changes = useStockChanges();
  if (!n || !activity || activity.supplyThen === null) return null;
  const now = spotPrice(n.supply, n);
  const then = spotPrice(activity.supplyThen, n);
  if (then === 0n) return null;
  const tokenMove = Number(now - then) / Number(then);
  const stockMove = changes[n.stockMint];
  if (stockMove === undefined) return { pct: tokenMove * 100, inStockTerms: true };
  return { pct: ((1 + tokenMove) * (1 + stockMove / 100) - 1) * 100, inStockTerms: false };
}
