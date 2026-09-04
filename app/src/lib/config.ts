import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
} from "@solana/kit";
import type { Address } from "@solana/kit";

export const APP_NAME = "Livestock";
export const TAGLINE = "Buy the story. When it expires, you get the stock.";

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

/** Classic SPL Token. */
export const TOKEN_PROGRAM = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

/** SPL Token-2022 — what real tokenized stocks and narrative mints use. */
export const TOKEN_2022_PROGRAM = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

// --- stocks ---------------------------------------------------------------

/** A tokenized stock narratives can expire into. */
export type StockInfo = {
  mint: Address;
  /** Ticker shown in the UI, e.g. "TSLAx". */
  symbol: string;
  decimals: number;
  /** Used for dollar labels only when the live price lookup fails. */
  fallbackPriceUsd: number;
  /** False for a stock that turned up on-chain but is not in the registry. */
  known: boolean;
};

/**
 * The stocks this deployment supports, in display order.
 *
 * `NEXT_PUBLIC_STOCKS` is a comma-separated list of
 * `SYMBOL:mint[:decimals[:fallbackUsd]]`. If unset, the single-stock variables
 * (`NEXT_PUBLIC_STOCK_MINT` and friends) define one entry. xStocks carry 8
 * decimals.
 */
function parseStocks(): StockInfo[] {
  const list = process.env.NEXT_PUBLIC_STOCKS ?? "";
  const out: StockInfo[] = [];

  for (const raw of list.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const [symbol, mint, decimals, price] = entry.split(":");
    if (!symbol || !mint) continue;
    try {
      out.push({
        symbol,
        mint: address(mint),
        decimals: decimals ? Number(decimals) : 8,
        fallbackPriceUsd: price ? Number(price) : 100,
        known: true,
      });
    } catch {
      // A malformed entry should not take the app down.
    }
  }

  const single = process.env.NEXT_PUBLIC_STOCK_MINT ?? "";
  if (out.length === 0 && single) {
    out.push({
      symbol: process.env.NEXT_PUBLIC_STOCK_SYMBOL ?? "TSLAx",
      mint: address(single),
      decimals: Number(process.env.NEXT_PUBLIC_STOCK_DECIMALS ?? 8),
      fallbackPriceUsd: Number(process.env.NEXT_PUBLIC_STOCK_PRICE_USD ?? 250),
      known: true,
    });
  }

  return out;
}

export const STOCKS: StockInfo[] = parseStocks();

/** The stock a new narrative defaults to. */
export const DEFAULT_STOCK: StockInfo | null = STOCKS[0] ?? null;

/**
 * Looks a stock up by mint. An unknown mint still renders — with its address
 * as the ticker and the decimals the narrative recorded on-chain.
 */
export function stockFor(mint: Address, decimals = 8): StockInfo {
  return (
    STOCKS.find((s) => s.mint === mint) ?? {
      mint,
      symbol: shortAddress(mint),
      decimals,
      fallbackPriceUsd: 0,
      known: false,
    }
  );
}

// Single-stock conveniences, kept for the create flow's defaults.
export const STOCK_MINT: Address | null = DEFAULT_STOCK?.mint ?? null;
export const STOCK_SYMBOL = DEFAULT_STOCK?.symbol ?? "TSLAx";
export const STOCK_DECIMALS = DEFAULT_STOCK?.decimals ?? 8;
export const FALLBACK_STOCK_PRICE_USD = DEFAULT_STOCK?.fallbackPriceUsd ?? 250;

// --- formatting -----------------------------------------------------------

export function shortAddress(value: string, chars = 4): string {
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}

export function formatUsd(value: number, places = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** Dollar figure with sensible precision for small per-token prices. */
export function formatUsdAuto(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return formatUsd(value, 4);
  return formatUsd(value, 2);
}

export function explorerUrl(addr: string): string {
  const cluster = CLUSTER === "mainnet" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/address/${addr}${cluster}`;
}
