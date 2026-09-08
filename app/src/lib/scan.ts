/**
 * Reading every narrative straight from account data. Shared by the server
 * route that does it on visitors' behalf and by the browser for a single
 * narrative. Takes the RPC client to use, so the server can bring its own.
 *
 * There is no indexer: this pulls every account owned by the program and
 * decodes it. Fine at this scale; the first thing to replace when it isn't.
 */

import {
  decodeNarrative,
  decodeTokenAmount,
  findNarrative,
  NARRATIVE_ACCOUNT_LEN,
  NARRATIVE_DISCRIMINATOR,
  NARRATIVE_MARKETS_PROGRAM_ID,
  type Narrative,
} from "@nm/client";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";

import { fetchTokenMeta, type TokenMeta } from "./metadata";

export type BareNarrative = Narrative & { address: Address };

/** A narrative with what the chain and its metadata say, before the registry adds the stock. */
export type ScannedNarrative = BareNarrative & {
  vaultBalance: bigint;
  meta: TokenMeta | null;
};

export type ScanRpc = Rpc<SolanaRpcApi>;

export function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** Balances of many token accounts in one RPC call. Missing accounts read 0. */
export async function fetchTokenAmounts(rpc: ScanRpc, addrs: Address[]): Promise<bigint[]> {
  if (addrs.length === 0) return [];
  const out: bigint[] = [];
  // getMultipleAccounts caps at 100 addresses per call.
  for (let i = 0; i < addrs.length; i += 100) {
    const chunk = addrs.slice(i, i + 100);
    const { value } = await rpc.getMultipleAccounts(chunk, { encoding: "base64" }).send();
    for (const account of value) {
      out.push(account ? decodeTokenAmount(decodeBase64(account.data[0])) : 0n);
    }
  }
  return out;
}

/** Every narrative account the program owns, decoded and checked. */
export async function scanNarratives(rpc: ScanRpc): Promise<BareNarrative[]> {
  const accounts = await rpc
    .getProgramAccounts(NARRATIVE_MARKETS_PROGRAM_ID, {
      encoding: "base64",
      // Size alone narrows it enough; discriminator and version are checked
      // by the decoder.
      filters: [{ dataSize: BigInt(NARRATIVE_ACCOUNT_LEN) }],
    })
    .send();

  const bare: BareNarrative[] = [];
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
      bare.push({ ...narrative, address: pubkey });
    } catch {
      // Skip anything that does not decode rather than failing the page.
    }
  }
  return bare;
}

/** Adds the live vault balance and off-chain metadata. */
export async function decorateNarratives(
  rpc: ScanRpc,
  bare: BareNarrative[],
  metaMaxAgeMs = Number.POSITIVE_INFINITY,
): Promise<ScannedNarrative[]> {
  const [balances, metas] = await Promise.all([
    fetchTokenAmounts(rpc, bare.map((n) => n.vault)),
    fetchTokenMeta(bare.map((n) => n.narrativeMint), rpc, metaMaxAgeMs),
  ]);
  return bare.map((n, i) => ({
    ...n,
    vaultBalance: balances[i] ?? 0n,
    meta: metas.get(n.narrativeMint) ?? null,
  }));
}
