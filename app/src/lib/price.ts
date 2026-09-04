"use client";

/**
 * Stock price lookup, used only to render dollar figures.
 *
 * Nothing on-chain depends on this — the curve and the vault are denominated
 * in the stock itself. A wrong or stale price here makes the UI's dollar
 * labels wrong; it cannot make a transaction wrong.
 */

import { useEffect, useState } from "react";

import { FALLBACK_STOCK_PRICE_USD, STOCK_MINT } from "./config";

const JUPITER_PRICE_API = "https://lite-api.jup.ag/price/v3";

async function fetchStockPrice(): Promise<number | null> {
  if (!STOCK_MINT) return null;

  try {
    const response = await fetch(`${JUPITER_PRICE_API}?ids=${STOCK_MINT}`);
    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;

    const entry = (body as Record<string, unknown>)[STOCK_MINT];
    if (typeof entry !== "object" || entry === null) return null;

    const price = (entry as Record<string, unknown>).usdPrice;
    return typeof price === "number" && price > 0 ? price : null;
  } catch {
    // A price feed outage should never take the page down.
    return null;
  }
}

/**
 * The stock's USD price, falling back to the configured constant.
 *
 * `isLive` says whether the number came from the feed, so the UI can be honest
 * about a fallback rather than quietly showing a made-up figure.
 */
export function useStockPrice(): { price: number; isLive: boolean } {
  const [price, setPrice] = useState(FALLBACK_STOCK_PRICE_USD);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const next = await fetchStockPrice();
      if (cancelled) return;
      if (next !== null) {
        setPrice(next);
        setIsLive(true);
      }
    };

    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { price, isLive };
}
