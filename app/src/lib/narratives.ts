"use client";

/**
 * Reading narratives and holder positions straight from account data.
 *
 * There is no indexer: the discover page pulls every account owned by the
 * program and decodes it client-side. Fine at this scale; the first thing to
 * replace when it isn't.
 */

import { useCallback, useEffect, useState } from "react";
import {
  decodeNarrative,
  decodeTokenAmount,
  findNarrativeMint,
  findVault,
  NARRATIVE_ACCOUNT_LEN,
  NARRATIVE_DISCRIMINATOR,
  NARRATIVE_MARKETS_PROGRAM_ID,
  type Narrative,
} from "@nm/client";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Address } from "@solana/kit";

import { rpc, STOCK_MINT, TOKEN_PROGRAM } from "./config";

export type NarrativeRow = Narrative & {
  address: Address;
  /** Live vault balance, which can exceed `finalVault` before expiry. */
  vaultBalance: bigint;
};

export type Position = {
  tokens: bigint;
  tokenAccount: Address;
  stockAccount: Address;
  stockBalance: bigint;
};

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

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

/** Every narrative the program knows about. */
async function loadAll(): Promise<NarrativeRow[]> {
  const accounts = await rpc
    .getProgramAccounts(NARRATIVE_MARKETS_PROGRAM_ID, {
      encoding: "base64",
      // Size alone narrows it enough; the discriminator is checked below.
      filters: [{ dataSize: BigInt(NARRATIVE_ACCOUNT_LEN) }],
    })
    .send();

  const rows: NarrativeRow[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      const data = decodeBase64(account.data[0]);
      if (data[0] !== NARRATIVE_DISCRIMINATOR) continue;
      const narrative = decodeNarrative(data);
      // Only show narratives for the stock this deployment is pointed at.
      if (STOCK_MINT && narrative.stockMint !== STOCK_MINT) continue;
      rows.push({
        ...narrative,
        address: pubkey,
        vaultBalance: await fetchTokenAmount(narrative.vault),
      });
    } catch {
      // Skip anything that does not decode rather than failing the page.
    }
  }

  // Expiring soonest first — the thing a visitor most wants to see.
  return rows.sort((a, b) => Number(a.expiryTs) - Number(b.expiryTs));
}

export function useNarratives(intervalMs = 8000) {
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

/** One narrative plus the connected wallet's position in it. */
export function useNarrative(
  narrativeAddress: Address | null,
  owner: Address | null,
  intervalMs = 4000,
) {
  const [narrative, setNarrative] = useState<NarrativeRow | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
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
      const row: NarrativeRow = {
        ...decoded,
        address: narrativeAddress,
        vaultBalance: await fetchTokenAmount(decoded.vault),
      };
      setNarrative(row);
      setError(null);

      if (owner) {
        const tokenAccount = await ata(decoded.narrativeMint, owner);
        const stockAccount = await ata(
          decoded.stockMint,
          owner,
          decoded.stockTokenProgram,
        );
        const [tokens, stockBalance] = await Promise.all([
          fetchTokenAmount(tokenAccount),
          fetchTokenAmount(stockAccount),
        ]);
        setPosition({ tokens, tokenAccount, stockAccount, stockBalance });
      } else {
        setPosition(null);
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

  return { narrative, position, error, loading, refresh };
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

export { findNarrativeMint, findVault, ata };
