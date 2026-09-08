"use client";

/**
 * Narratives and holder positions, in the browser.
 *
 * The list comes from /api/narratives, which scans the program's accounts
 * once on the server and shares the result. A single narrative is read
 * straight from the chain here, so a page refreshes as fast as the chain
 * does. The registry adds the stock and decides what is shown.
 */

import { useCallback, useEffect, useState } from "react";
import { decodeNarrative, decodeTokenAmount, findVault, type Narrative } from "@nm/client";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Address } from "@solana/kit";

import {
  getStocks,
  rpc,
  stockFor,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  type StockInfo,
} from "./config";
import { parseBig } from "./json-big";
import type { TokenMeta } from "./metadata";
import {
  decodeBase64,
  decorateNarratives,
  fetchTokenAmounts,
  type BareNarrative,
  type ScannedNarrative,
} from "./scan";

export type NarrativeRow = Narrative & {
  address: Address;
  /** Live vault balance, which can exceed `finalVault` before expiry. */
  vaultBalance: bigint;
  /** The stock this narrative expires into. */
  stock: StockInfo;
  /** Off-chain metadata: image, description, links. */
  meta: TokenMeta | null;
};

export type Position = {
  tokens: bigint;
  tokenAccount: Address;
  stockAccount: Address;
  stockBalance: bigint;
};

async function fetchData(addr: Address): Promise<Uint8Array | null> {
  const { value } = await rpc
    .getAccountInfo(addr, { encoding: "base64" })
    .send();
  return value ? decodeBase64(value.data[0]) : null;
}

async function fetchTokenAmount(addr: Address): Promise<bigint> {
  const data = await fetchData(addr);
  return data ? decodeTokenAmount(data) : 0n;
}

async function ata(
  mint: Address,
  owner: Address,
  tokenProgram: Address = TOKEN_PROGRAM_ADDRESS,
): Promise<Address> {
  const [pda] = await findAssociatedTokenPda({ mint, owner, tokenProgram });
  return pda;
}

/**
 * Which token program the stock mint belongs to, read from the mint's owner.
 *
 * Real tokenized stocks are Token-2022 while most other mints are classic SPL,
 * and the two produce different associated token addresses — so this is
 * discovered rather than assumed.
 */
export async function fetchStockTokenProgram(
  stockMint: Address,
): Promise<Address> {
  const { value } = await rpc
    .getAccountInfo(stockMint, { encoding: "base64" })
    .send();
  return (value?.owner as Address | undefined) ?? TOKEN_PROGRAM;
}

/** The registry's part: which stock, and whether this deployment shows it at all. */
function withStock(rows: ScannedNarrative[]): NarrativeRow[] {
  // The registry limits the page to stocks this deployment knows. Until it
  // has loaded (or with nothing configured), show everything.
  const stocks = getStocks();
  return rows
    .filter((n) => stocks.length === 0 || stocks.some((s) => s.mint === n.stockMint))
    .map((n) => ({ ...n, stock: stockFor(n.stockMint, n.stockDecimals) }));
}

async function decorate(bare: BareNarrative[]): Promise<NarrativeRow[]> {
  return withStock(await decorateNarratives(rpc, bare));
}

/** Every narrative, from the server's shared scan. */
async function loadAll(): Promise<NarrativeRow[]> {
  const response = await fetch("/api/narratives", { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `The narrative list failed to load (${response.status}).`);
  }
  const { narratives } = parseBig<{ narratives: ScannedNarrative[] }>(await response.text());
  const rows = withStock(narratives);
  // Expiring soonest first — the thing a visitor most wants to see.
  return rows.sort((a, b) => Number(a.expiryTs) - Number(b.expiryTs));
}

export function useNarratives(intervalMs = 10_000) {
  const [rows, setRows] = useState<NarrativeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await loadAll());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { rows, error, refresh };
}

/** One narrative, the connected wallet's position, and the creator's stake. */
export function useNarrative(
  narrativeAddress: Address | null,
  owner: Address | null,
  intervalMs = 5_000,
) {
  const [narrative, setNarrative] = useState<NarrativeRow | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [creatorHoldings, setCreatorHoldings] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!narrativeAddress) {
      setLoading(false);
      return;
    }
    try {
      const data = await fetchData(narrativeAddress);
      if (!data) {
        setNarrative(null);
        setError("This narrative does not exist.");
        return;
      }

      const decoded = decodeNarrative(data);
      const [row] = await decorate([{ ...decoded, address: narrativeAddress }]);
      setNarrative(row);
      setError(null);

      // Creator front-running is disclosed rather than prevented: show what
      // they hold.
      const creatorTokens = await ata(
        decoded.narrativeMint,
        decoded.creator,
        TOKEN_2022_PROGRAM,
      );

      if (owner) {
        const tokenAccount = await ata(
          decoded.narrativeMint,
          owner,
          TOKEN_2022_PROGRAM,
        );
        const stockAccount = await ata(
          decoded.stockMint,
          owner,
          decoded.stockTokenProgram,
        );
        const [tokens, stockBalance, creator] = await fetchTokenAmounts(rpc, [
          tokenAccount,
          stockAccount,
          creatorTokens,
        ]);
        setPosition({ tokens, tokenAccount, stockAccount, stockBalance });
        setCreatorHoldings(creator);
      } else {
        setPosition(null);
        setCreatorHoldings(await fetchTokenAmount(creatorTokens));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [narrativeAddress, owner]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { narrative, position, creatorHoldings, error, loading, refresh };
}

/** Ticks once a second so countdowns re-render. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** `3d 04h`, `04:12:33`, or `—` once elapsed. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "—";

  const days = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (days > 0) return `${days}d ${String(h).padStart(2, "0")}h`;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** `Sep 18, 14:02` in the viewer's locale. */
export function formatDate(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export { findVault, ata };
