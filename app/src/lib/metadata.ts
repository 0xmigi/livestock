"use client";

/**
 * Off-chain token metadata for narrative mints.
 *
 * Every narrative mint carries a `TokenMetadata` extension whose `uri` points
 * at a JSON document with the image. This reads the extension off the mint,
 * fetches the JSON once, and caches it for the session.
 */

import { fetchAllMaybeMint } from "@solana-program/token-2022";
import { unwrapOption, type Address } from "@solana/kit";

import { rpc } from "./config";

export type TokenMeta = {
  uri: string;
  /** The mint's permanent delegate. When it is the narrative, holders are paid out at expiry without signing. */
  permanentDelegate?: Address;
  image?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
};

const cache = new Map<Address, Promise<TokenMeta | null>>();

async function fetchJson(uri: string): Promise<Partial<TokenMeta>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    // Metadata can be edited in place, so never trust a cached copy.
    const response = await fetch(uri, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return {};
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return {};
    const b = body as Record<string, unknown>;
    const str = (key: string) =>
      typeof b[key] === "string" && (b[key] as string).length > 0
        ? (b[key] as string)
        : undefined;
    return {
      image: str("image"),
      description: str("description"),
      website: str("website"),
      twitter: str("twitter"),
      telegram: str("telegram"),
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** Forgets a mint's metadata so the next read fetches it again. */
export function invalidateTokenMeta(mint: Address): void {
  cache.delete(mint);
}

/** Reads metadata for a batch of narrative mints. Missing entries are null. */
export async function fetchTokenMeta(
  mints: Address[],
): Promise<Map<Address, TokenMeta | null>> {
  const missing = mints.filter((m) => !cache.has(m));

  if (missing.length > 0) {
    // Resolve in one RPC call, then fan out to the JSON documents.
    const batch = fetchAllMaybeMint(rpc, missing).catch(() => null);
    for (const mint of missing) {
      cache.set(
        mint,
        batch.then(async (accounts) => {
          const account = accounts?.find((a) => a.address === mint);
          if (!account || !account.exists) return null;
          const extensions = unwrapOption(account.data.extensions) ?? [];
          const meta = extensions.find((e) => e.__kind === "TokenMetadata");
          if (!meta || meta.__kind !== "TokenMetadata" || !meta.uri) return null;
          const delegate = extensions.find((e) => e.__kind === "PermanentDelegate");
          const permanentDelegate =
            delegate?.__kind === "PermanentDelegate" ? (delegate.delegate as Address) : undefined;
          if (!/^https?:\/\//.test(meta.uri)) return { uri: meta.uri, permanentDelegate };
          return { uri: meta.uri, permanentDelegate, ...(await fetchJson(meta.uri)) };
        }),
      );
    }
  }

  const out = new Map<Address, TokenMeta | null>();
  await Promise.all(
    mints.map(async (m) => {
      out.set(m, (await cache.get(m)) ?? null);
    }),
  );
  return out;
}
