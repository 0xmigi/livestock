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
  findNarrative,
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

import {
  getStocks,
  rpc,
  stockFor,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  type StockInfo,
} from "./config";
import { fetchTokenMeta, type TokenMeta } from "./metadata";

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

/** Balances of many token accounts in one RPC call. Missing accounts read 0. */
async function fetchTokenAmounts(addrs: Address[]): Promise<bigint[]> {
  if (addrs.length === 0) return [];
  const out: bigint[] = [];
  // getMultipleAccounts caps at 100 addresses per call.
  for (let i = 0; i < addrs.length; i += 100) {
    const chunk = addrs.slice(i, i + 100);
    const { value } = await rpc
      .getMultipleAccounts(chunk, { encoding: "base64" })
      .send();
    for (const account of value) {
      out.push(account ? decodeTokenAmount(decodeBase64(account.data[0])) : 0n);
    }
  }
  return out;
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

async function decorate(
  bare: (Narrative & { address: Address })[],
): Promise<NarrativeRow[]> {
  const [balances, metas] = await Promise.all([
    fetchTokenAmounts(bare.map((n) => n.vault)),
    fetchTokenMeta(bare.map((n) => n.narrativeMint)),
  ]);

  return bare.map((n, i) => ({
    ...n,
    vaultBalance: balances[i] ?? 0n,
    stock: stockFor(n.stockMint, n.stockDecimals),
    meta: metas.get(n.narrativeMint) ?? null,
  }));
}

/** Every narrative the program knows about. */
async function loadAll(): Promise<NarrativeRow[]> {
  const accounts = await rpc
    .getProgramAccounts(NARRATIVE_MARKETS_PROGRAM_ID, {
      encoding: "base64",
      // Size alone narrows it enough; discriminator and version are checked
      // by the decoder.
      filters: [{ dataSize: BigInt(NARRATIVE_ACCOUNT_LEN) }],
    })
    .send();

  const bare: (Narrative & { address: Address })[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      const data = decodeBase64(account.data[0]);
      if (data[0] !== NARRATIVE_DISCRIMINATOR) continue;
      const narrative = decodeNarrative(data);

      // Accounts from earlier layouts that happen to share the size and
      // version byte are rejected here: their address will not match the
      // current seed derivation.
      const [expected] = await findNarrative(narrative.narrativeMint);
      if (expected !== pubkey) continue;

      // The registry limits the page to stocks this deployment knows. Until
      // it has loaded (or with nothing configured), show everything.
      const stocks = getStocks();
      if (stocks.length > 0 && !stocks.some((s) => s.mint === narrative.stockMint)) {
        continue;
      }

      bare.push({ ...narrative, address: pubkey });
    } catch {
      // Skip anything that does not decode rather than failing the page.
    }
  }

  const rows = await decorate(bare);
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
        const [tokens, stockBalance, creator] = await fetchTokenAmounts([
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
