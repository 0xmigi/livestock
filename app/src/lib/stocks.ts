"use client";

/**
 * The stock registry, loaded from /api/stocks (the Tokens API) and shared by
 * every component.
 *
 * On mainnet the list is used as it comes. On devnet real tokenized stocks do
 * not exist, so each listed stock whose symbol has a stand-in mint in
 * `NEXT_PUBLIC_STOCKS` is pointed at that mint and the rest are shown but
 * marked unavailable: the full catalogue is visible, and only what the
 * program can actually convert into is pickable.
 */

import { useEffect, useState } from "react";
import { address } from "@solana/kit";

import type { StockListing } from "@/app/api/stocks/route";
import { CLUSTER, ENV_STOCKS, getStocks, setStocks, type StockInfo } from "./config";

const REFRESH_MS = 60_000;

type State = {
  /** True once the first answer, good or bad, has arrived. */
  loaded: boolean;
  error: string | null;
  /** SOL in USD, from the same feed. */
  solUsd: number | null;
};

let state: State = { loaded: false, error: null, solUsd: null };
const listeners = new Set<() => void>();
let started = false;

function notify() {
  for (const l of listeners) l();
}

function fromListing(l: StockListing): StockInfo | null {
  try {
    return {
      mint: address(l.mint),
      symbol: l.symbol,
      ticker: l.ticker,
      name: l.name,
      decimals: l.decimals,
      fallbackPriceUsd: l.priceUsd ?? 0,
      known: true,
      available: CLUSTER === "mainnet",
      icon: l.icon,
      issuer: l.issuer,
      tier: l.tier,
      liquidityUsd: l.liquidityUsd,
      priceUsd: l.priceUsd,
      change24hPercent: l.change24hPercent,
    };
  } catch {
    return null;
  }
}

/** The API's list, with the environment's pins applied. */
function merge(listings: StockListing[]): StockInfo[] {
  const pinned = new Map(ENV_STOCKS.map((s) => [s.symbol.toUpperCase(), s]));
  const seen = new Set<string>();
  const out: StockInfo[] = [];

  for (const listing of listings) {
    const base = fromListing(listing);
    if (!base) continue;
    const pin = pinned.get(base.symbol.toUpperCase());
    if (pin) {
      // The pin says which mint this symbol is on this cluster.
      pinned.delete(base.symbol.toUpperCase());
      out.push({ ...base, mint: pin.mint, decimals: pin.decimals, available: true });
      seen.add(pin.mint);
    } else if (!seen.has(base.mint)) {
      out.push(base);
      seen.add(base.mint);
    }
  }

  // Pins the API does not list stay as configured.
  for (const s of pinned.values()) {
    if (!seen.has(s.mint)) out.push(s);
  }

  return out.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);
  });
}

async function load() {
  try {
    const response = await fetch("/api/stocks");
    const body = (await response.json()) as {
      stocks?: StockListing[];
      solUsd?: number | null;
      error?: string;
    };
    if (!response.ok || !body.stocks) {
      throw new Error(body.error ?? `The stock list failed to load (${response.status}).`);
    }
    setStocks(merge(body.stocks));
    state = { loaded: true, error: null, solUsd: body.solUsd ?? state.solUsd };
  } catch (cause) {
    // Keep whatever was there (the environment's entries at worst) and say why.
    state = { ...state, loaded: true, error: cause instanceof Error ? cause.message : String(cause) };
  }
  notify();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  void load();
  setInterval(() => void load(), REFRESH_MS);
}

/** Every stock the app knows about, available ones first, plus load state. */
export function useStocks(): { stocks: StockInfo[]; loaded: boolean; error: string | null } {
  const [, tick] = useState(0);
  useEffect(() => {
    start();
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { stocks: getStocks(), loaded: state.loaded, error: state.error };
}

/** SOL's USD price, or null until the feed has answered. */
export function useSolPrice(): number | null {
  useStocks();
  return state.solUsd;
}

/** Case-insensitive match on ticker, symbol or name, for a picker's search box. */
export function matchesStock(s: StockInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    s.ticker.toLowerCase().includes(q) ||
    s.symbol.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q)
  );
}
