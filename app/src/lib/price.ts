"use client";

/**
 * Stock prices, used only to render dollar figures.
 *
 * They ride along with the registry (src/lib/stocks.ts): the Tokens API
 * reports a USD price and 24h change for every stock it lists, and on devnet
 * the stand-in mints inherit the real stock's figures through the symbol pin.
 *
 * Nothing on-chain depends on this — the curve and the vault are denominated
 * in the stock itself. A wrong or stale price here makes the UI's dollar
 * labels wrong; it cannot make a transaction wrong.
 */

import { useMemo } from "react";
import type { Address } from "@solana/kit";

import { defaultStock, stockFor } from "./config";
import { useStocks } from "./stocks";

type PriceMap = Record<string, number>;

/** Live USD prices for every registered stock, keyed by mint. */
export function useStockPrices(): PriceMap {
  const { stocks } = useStocks();
  return useMemo(() => {
    const out: PriceMap = {};
    for (const s of stocks) {
      if (s.priceUsd !== undefined && s.priceUsd > 0) out[s.mint] = s.priceUsd;
    }
    return out;
  }, [stocks]);
}

/** 24h change of every registered stock's price, keyed by mint. */
export function useStockChanges(): PriceMap {
  const { stocks } = useStocks();
  return useMemo(() => {
    const out: PriceMap = {};
    for (const s of stocks) {
      if (s.change24hPercent !== undefined) out[s.mint] = s.change24hPercent;
    }
    return out;
  }, [stocks]);
}

/**
 * One stock's USD price, falling back to its configured constant.
 *
 * `isLive` says whether the number came from the feed, so the UI can be honest
 * about a fallback rather than quietly showing a made-up figure.
 */
export function useStockPrice(mint?: Address | null): {
  price: number;
  isLive: boolean;
} {
  const prices = useStockPrices();
  const target = mint ?? defaultStock()?.mint ?? null;
  if (!target) return { price: 0, isLive: false };

  const live = prices[target];
  if (live !== undefined) return { price: live, isLive: true };
  return { price: stockFor(target).fallbackPriceUsd, isLive: false };
}
