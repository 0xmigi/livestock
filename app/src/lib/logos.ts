"use client";

/**
 * Stock logos and names, keyed by mint.
 *
 * Both come from the registry (the Tokens API, via src/lib/stocks.ts). Purely
 * decorative: a stock with no logo renders as a lettermark.
 */

import { useMemo } from "react";

import { useStocks } from "./stocks";

export type StockMeta = { icon?: string; name?: string };
type MetaMap = Record<string, StockMeta>;

/** Logo and company name for every registered stock, keyed by mint. */
export function useStockMeta(): MetaMap {
  const { stocks } = useStocks();
  return useMemo(() => {
    const out: MetaMap = {};
    for (const s of stocks) out[s.mint] = { icon: s.icon, name: s.name };
    return out;
  }, [stocks]);
}
