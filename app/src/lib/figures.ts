/**
 * Dollar figures for a narrative, shared by the markets list and analytics.
 * Every figure is the on-chain quantity in the stock, times the stock's
 * price; a wrong price makes a label wrong, never a transaction.
 */

import { spotPrice, TOKEN_TOTAL_SUPPLY } from "@nm/client";

import type { Phase } from "@/components/ui";
import { formatUsd } from "./config";
import type { NarrativeRow } from "./narratives";

export type PriceMap = Record<string, number>;

export function isLivePhase(phase: Phase): boolean {
  return phase === "live" || phase === "closing";
}

/** What backs the tokens right now: the live vault, or what was frozen at expiry. */
export function backingOf(n: NarrativeRow, phase: Phase): bigint {
  return isLivePhase(phase) || phase === "settling" ? n.vaultBalance : n.finalVault;
}

export function priceOf(n: NarrativeRow, prices: PriceMap): number {
  return prices[n.stockMint] ?? n.stock.fallbackPriceUsd;
}

export function usdOf(n: NarrativeRow, units: bigint | number, prices: PriceMap): number {
  return (Number(units) / 10 ** n.stock.decimals) * priceOf(n, prices);
}

/** What the next token costs, in dollars. */
export function tokenPriceOf(n: NarrativeRow, prices: PriceMap): number {
  return usdOf(n, spotPrice(n), prices);
}

/**
 * Spot price times the billion-token total supply: pump.fun's market cap,
 * the number every launchpad leads with.
 */
export function fdvOf(n: NarrativeRow, prices: PriceMap): number {
  return usdOf(n, spotPrice(n) * Number(TOKEN_TOTAL_SUPPLY), prices);
}

/** `3h ago`, `2d ago`. */
export function formatAgo(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function compact(usd: number): string {
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(usd >= 1e7 ? 0 : 1)}M`;
  if (usd >= 1e4) return `$${(usd / 1e3).toFixed(0)}k`;
  return formatUsd(usd, 0);
}
