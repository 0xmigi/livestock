"use client";

/**
 * Stock price lookup, used only to render dollar figures.
 *
 * Nothing on-chain depends on this — the curve and the vault are denominated
 * in the stock itself. A wrong or stale price here makes the UI's dollar
 * labels wrong; it cannot make a transaction wrong.
 */

import { useEffect, useState } from "react";
import type { Address } from "@solana/kit";

import { DEFAULT_STOCK, STOCKS, stockFor } from "./config";

const JUPITER_PRICE_API = "https://lite-api.jup.ag/price/v3";

type PriceMap = Record<string, number>;

/** 24h percent change per mint, when the feed reports one. */
let changeCache: PriceMap = {};

async function fetchPrices(mints: Address[]): Promise<PriceMap> {
  if (mints.length === 0) return {};

  try {
    const response = await fetch(
      `${JUPITER_PRICE_API}?ids=${mints.join(",")}`,
    );
    if (!response.ok) return {};

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return {};

    const out: PriceMap = {};
    for (const mint of mints) {
      const entry = (body as Record<string, unknown>)[mint];
      if (typeof entry !== "object" || entry === null) continue;
      const price = (entry as Record<string, unknown>).usdPrice;
      if (typeof price === "number" && price > 0) out[mint] = price;
      const change = (entry as Record<string, unknown>).priceChange24h;
      if (typeof change === "number") changeCache = { ...changeCache, [mint]: change };
    }
    return out;
  } catch {
    // A price feed outage should never take the page down.
    return {};
  }
}

// Shared across hooks so every component sees the same numbers.
let cache: PriceMap = {};
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const load = async () => {
    const next = await fetchPrices(STOCKS.map((s) => s.mint));
    if (Object.keys(next).length > 0) {
      cache = { ...cache, ...next };
      for (const l of listeners) l();
    }
  };
  void load();
  setInterval(() => void load(), 60_000);
}

/** 24h change of every registered stock's price, keyed by mint. */
export function useStockChanges(): PriceMap {
  useStockPrices();
  return changeCache;
}

/** Live USD prices for every registered stock, keyed by mint. */
export function useStockPrices(): PriceMap {
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
  const target = mint ?? DEFAULT_STOCK?.mint ?? null;
  if (!target) return { price: 0, isLive: false };

  const live = prices[target];
  if (live !== undefined) return { price: live, isLive: true };
  return { price: stockFor(target).fallbackPriceUsd, isLive: false };
}
