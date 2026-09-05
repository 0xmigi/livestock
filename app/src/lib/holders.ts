"use client";

/**
 * Who holds a narrative token, from the mint's largest token accounts. The
 * RPC returns the top twenty, which is exact while a narrative is small and
 * a floor ("20+") once it is not. Every wallet's account is found through
 * the account's owner, so the creator can be recognised.
 */

import { useEffect, useState } from "react";
import type { Address } from "@solana/kit";

import { rpc } from "./config";

export type Holders = {
  /** Distinct wallets with a balance, exact up to twenty. */
  count: number;
  /** True when there are more than the twenty accounts the RPC returns. */
  more: boolean;
  /** The largest balance and who owns it. */
  top: bigint;
  topOwner: Address | null;
};

const cache = new Map<string, Promise<Holders | null>>();

async function scan(mint: Address): Promise<Holders> {
  const { value } = await rpc.getTokenLargestAccounts(mint).send();
  const held = value.filter((v) => BigInt(v.amount) > 0n);
  let topOwner: Address | null = null;
  if (held.length > 0) {
    const info = await rpc.getAccountInfo(held[0].address, { encoding: "jsonParsed" }).send();
    const parsed = info.value?.data as { parsed?: { info?: { owner?: string } } } | undefined;
    const owner = parsed && "parsed" in parsed ? parsed.parsed?.info?.owner : undefined;
    topOwner = (owner as Address | undefined) ?? null;
  }
  return {
    count: held.length,
    more: value.length >= 20,
    top: held.length > 0 ? BigInt(held[0].amount) : 0n,
    topOwner,
  };
}

/** Null when the RPC would not answer (public endpoints rate-limit this call). */
function load(mint: Address): Promise<Holders | null> {
  const key = mint as string;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = scan(mint).catch(() => null);
  cache.set(key, p);
  setTimeout(() => cache.delete(key), 60_000);
  return p;
}

export function useHolders(mint: Address | null): Holders | null {
  const [holders, setHolders] = useState<Holders | null>(null);
  useEffect(() => {
    if (!mint) return;
    let cancelled = false;
    void load(mint).then((h) => {
      if (!cancelled && h) setHolders(h);
    });
    return () => {
      cancelled = true;
    };
  }, [mint]);
  return holders;
}
