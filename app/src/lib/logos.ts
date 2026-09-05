"use client";

/**
 * Stock logos and names from Jupiter's token list, cached for the session.
 *
 * Looked up by mint first. A stand-in mint on devnet has no listing, so the
 * symbol is tried next and the deepest market with that exact symbol wins,
 * which is the real xStock. Purely decorative: a stock with nothing found
 * renders as a lettermark.
 */

import { useEffect, useState } from "react";
import type { Address } from "@solana/kit";

import { STOCKS } from "./config";

const TOKEN_API = "https://lite-api.jup.ag/tokens/v2/search";

export type StockMeta = { icon?: string; name?: string };
type MetaMap = Record<string, StockMeta>;

type Listing = { id?: string; symbol?: string; name?: string; icon?: string; liquidity?: number };

let cache: MetaMap = {};
const listeners = new Set<() => void>();
let started = false;

async function search(query: string): Promise<Listing[]> {
  try {
    const response = await fetch(`${TOKEN_API}?query=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const body: unknown = await response.json();
    return Array.isArray(body) ? (body as Listing[]) : [];
  } catch {
    return [];
  }
}

async function lookup(mint: Address, symbol: string): Promise<StockMeta | null> {
  const byMint = (await search(mint)).find((t) => t.id === mint);
  const hit =
    byMint ??
    (await search(symbol))
      .filter((t) => t.symbol === symbol)
      .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0];
  if (!hit) return null;
  return {
    icon: typeof hit.icon === "string" && hit.icon.length > 0 ? hit.icon : undefined,
    name: typeof hit.name === "string" ? hit.name.replace(/\s*xStock$/i, "") : undefined,
  };
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  void Promise.all(
    STOCKS.map(async (s) => {
      const meta = await lookup(s.mint, s.symbol);
      if (meta) cache = { ...cache, [s.mint]: meta };
    }),
  ).then(() => {
    for (const l of listeners) l();
  });
}

/** Logo and company name for every registered stock, keyed by mint. */
export function useStockMeta(): MetaMap {
  const [, tick] = useState(0);
  useEffect(() => {
    start();
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return cache;
}
