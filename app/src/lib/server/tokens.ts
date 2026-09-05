/**
 * Server-side reads from the Tokens API that need more than the stock list:
 * which canonical asset a mint is, and its price history.
 */

import type { Address } from "@solana/kit";

const TOKENS_API = "https://api.tokens.xyz/v1";

function headers(): HeadersInit {
  const key = process.env.TOKENS_API_KEY;
  if (!key) throw new Error("TOKENS_API_KEY is not set in app/.env.local.");
  return { "x-api-key": key };
}

type CuratedAsset = { assetId?: string; primaryVariant?: { mint?: string; symbol?: string } | null };

async function curated(): Promise<CuratedAsset[]> {
  const response = await fetch(`${TOKENS_API}/assets/curated?list=stocks`, {
    headers: headers(),
    next: { revalidate: 300 },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { assets?: CuratedAsset[] };
  return body.assets ?? [];
}

/** The pinned symbol for a mint, if NEXT_PUBLIC_STOCKS names it (devnet stand-ins). */
function pinnedSymbol(mint: Address): string | null {
  for (const raw of (process.env.NEXT_PUBLIC_STOCKS ?? "").split(",")) {
    const [symbol, pinned] = raw.trim().split(":");
    if (pinned === mint) return symbol ?? null;
  }
  return null;
}

/** The Tokens API asset behind a stock mint: by mint on mainnet, by pinned symbol on devnet. */
export async function assetIdForMint(mint: Address): Promise<string | null> {
  const symbol = pinnedSymbol(mint);
  for (const a of await curated()) {
    if (a.primaryVariant?.mint === mint) return a.assetId ?? null;
    if (symbol && a.primaryVariant?.symbol === symbol) return a.assetId ?? null;
  }
  return null;
}

export type Candle = { time: number; close: number };

/** Candles fine enough for the window: minutes for an hour, hours for a week. */
export function intervalFor(seconds: number): "1m" | "5m" | "15m" | "1H" | "4H" | "1D" {
  if (seconds <= 2 * 3600) return "1m";
  if (seconds <= 12 * 3600) return "5m";
  if (seconds <= 3 * 86_400) return "15m";
  if (seconds <= 14 * 86_400) return "1H";
  if (seconds <= 60 * 86_400) return "4H";
  return "1D";
}

async function candles(assetId: string, interval: string, from: number, to: number): Promise<Candle[]> {
  const url = `${TOKENS_API}/assets/${encodeURIComponent(assetId)}/ohlcv?interval=${interval}&from=${from}&to=${to}`;
  const response = await fetch(url, { headers: headers(), next: { revalidate: 60 } });
  if (!response.ok) return [];
  const body = (await response.json()) as { candles?: { time?: number; close?: number }[] };
  return (body.candles ?? [])
    .filter((c): c is { time: number; close: number } => typeof c.time === "number" && typeof c.close === "number")
    .map((c) => ({ time: c.time, close: c.close }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Closing prices up to and through a window, oldest first. The history can
 * lag the present by hours, so the fetch reaches back before the window and
 * coarsens until something comes back; callers carry the last price forward.
 */
export async function fetchCandles(assetId: string, from: number, to: number): Promise<Candle[]> {
  const fine = intervalFor(to - from);
  const attempts: [string, number][] = [
    [fine, 6 * 3600],
    ["1H", 3 * 86_400],
    ["1D", 30 * 86_400],
  ];
  for (const [interval, reach] of attempts) {
    const found = await candles(assetId, interval, from - reach, to);
    if (found.length > 0) return found;
  }
  return [];
}
