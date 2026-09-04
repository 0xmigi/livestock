import { address, createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import type { Address } from "@solana/kit";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Which cluster to run against. Privy's RPC registry only accepts
 * `solana:mainnet`, `solana:devnet` and `solana:testnet`, and `chain` defaults
 * to **mainnet** when omitted — so every signing call passes this explicitly.
 */
export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as
  | "mainnet"
  | "devnet";

export const SOLANA_CHAIN = `solana:${CLUSTER}` as
  | "solana:mainnet"
  | "solana:devnet";

const DEFAULT_RPC =
  CLUSTER === "mainnet"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";
const DEFAULT_WS =
  CLUSTER === "mainnet"
    ? "wss://api.mainnet-beta.solana.com"
    : "wss://api.devnet.solana.com";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? DEFAULT_RPC;
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? DEFAULT_WS;

export const rpc = createSolanaRpc(RPC_URL);
export const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

const rawStockMint = process.env.NEXT_PUBLIC_STOCK_MINT ?? "";

/** The tokenized stock narratives are denominated in. */
export const STOCK_MINT: Address | null = rawStockMint
  ? address(rawStockMint)
  : null;

/** Ticker shown in the UI, e.g. "TSLAx". */
export const STOCK_SYMBOL = process.env.NEXT_PUBLIC_STOCK_SYMBOL ?? "TSLAx";

/** Classic SPL Token. */
export const TOKEN_PROGRAM = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

/** SPL Token-2022 — what real tokenized stocks use. */
export const TOKEN_2022_PROGRAM = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

/** xStocks carry 8 decimals. */
export const STOCK_DECIMALS = Number(
  process.env.NEXT_PUBLIC_STOCK_DECIMALS ?? 8,
);

/**
 * Fallback stock price, used to render dollar figures when the live price
 * lookup is unavailable. See `lib/price.ts`.
 */
export const FALLBACK_STOCK_PRICE_USD = Number(
  process.env.NEXT_PUBLIC_STOCK_PRICE_USD ?? 250,
);

export function shortAddress(value: string, chars = 4): string {
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}

export function formatUsd(value: number, places = 2): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}
