/**
 * The devnet swap counterparty.
 *
 * Real tokenized stocks do not exist on devnet, so there is nothing for a
 * router to swap SOL into. This stands in for that leg: a server-held wallet
 * that holds every stand-in stock and sells it for SOL at the live Tokens API
 * rate, inside the buyer's own transaction. The shape is the mainnet shape
 * (swap, then buy, one signature); only the counterparty differs.
 *
 * The key is worthless outside devnet, but the signer still refuses anything
 * that is not exactly "SOL in, one stock out at the quoted rate".
 */

import {
  address,
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const TOKENS_API = "https://api.tokens.xyz/v1";
const LAMPORTS_PER_SOL = 1_000_000_000;

export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";

/** A stand-in stock the faucet can sell: the NEXT_PUBLIC_STOCKS pins. */
export type Pin = { symbol: string; mint: Address; decimals: number };

export function pins(): Pin[] {
  const out: Pin[] = [];
  for (const raw of (process.env.NEXT_PUBLIC_STOCKS ?? "").split(",")) {
    const [symbol, mint, decimals] = raw.trim().split(":");
    if (!symbol || !mint) continue;
    try {
      out.push({ symbol, mint: address(mint), decimals: decimals ? Number(decimals) : 8 });
    } catch {
      // A malformed pin is skipped, as the app skips it.
    }
  }
  return out;
}

let signerPromise: Promise<KeyPairSigner> | null = null;

/** The faucet's keypair, from DEVNET_FAUCET_KEYPAIR (a JSON byte array). */
export function faucetSigner(): Promise<KeyPairSigner> {
  if (!signerPromise) {
    signerPromise = (async () => {
      const raw = process.env.DEVNET_FAUCET_KEYPAIR;
      if (!raw) throw new Error("DEVNET_FAUCET_KEYPAIR is not set in app/.env.local.");
      const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
      return createKeyPairSignerFromBytes(bytes);
    })();
  }
  return signerPromise;
}

export async function faucetAta(mint: Address): Promise<Address> {
  const { address: owner } = await faucetSigner();
  const [ata] = await findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

function headers(): HeadersInit {
  const key = process.env.TOKENS_API_KEY;
  if (!key) throw new Error("TOKENS_API_KEY is not set in app/.env.local.");
  return { "x-api-key": key };
}

/** SOL in USD. */
export async function solUsd(): Promise<number> {
  const response = await fetch(`${TOKENS_API}/assets/sol`, {
    headers: headers(),
    next: { revalidate: 30 },
  });
  if (!response.ok) throw new Error(`Tokens API returned ${response.status} for SOL.`);
  const body = (await response.json()) as { asset?: { stats?: { price?: number } } };
  const price = body.asset?.stats?.price;
  if (typeof price !== "number" || price <= 0) throw new Error("No SOL price from the Tokens API.");
  return price;
}

/** A stand-in's USD price: the real stock's, looked up by symbol. */
export async function stockUsd(symbol: string): Promise<number> {
  const response = await fetch(`${TOKENS_API}/assets/curated?list=stocks`, {
    headers: headers(),
    next: { revalidate: 60 },
  });
  if (!response.ok) throw new Error(`Tokens API returned ${response.status} for the stock list.`);
  const body = (await response.json()) as {
    assets?: { stats?: { price?: number }; primaryVariant?: { symbol?: string } }[];
  };
  const hit = body.assets?.find((a) => a.primaryVariant?.symbol === symbol);
  const price = hit?.stats?.price;
  if (typeof price !== "number" || price <= 0) throw new Error(`No price for ${symbol}.`);
  return price;
}

export type Quote = {
  pin: Pin;
  lamportsIn: bigint;
  stockOut: bigint;
  solUsd: number;
  stockUsd: number;
};

/** How much of a stand-in stock `lamports` buys at the live rate. */
export async function quote(stockMint: Address, lamports: bigint): Promise<Quote> {
  const pin = pins().find((p) => p.mint === stockMint);
  if (!pin) throw new Error("That stock is not available on devnet.");
  const [sol, stock] = await Promise.all([solUsd(), stockUsd(pin.symbol)]);
  const usd = (Number(lamports) / LAMPORTS_PER_SOL) * sol;
  const stockOut = BigInt(Math.floor((usd / stock) * 10 ** pin.decimals));
  return { pin, lamportsIn: lamports, stockOut, solUsd: sol, stockUsd: stock };
}
