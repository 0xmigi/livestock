import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
} from "@solana/kit";
import type { Address } from "@solana/kit";

export const APP_NAME = "Livestock";

/** The bio is a hard cap, the way a profile bio is. */
export const BIO_MAX_CHARS = 160;
export const TAGLINE = "Buy the narrative. When it expires, you get the stock.";

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

// An empty variable counts as unset: hosts often define every name at once.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC;
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || DEFAULT_WS;

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
  /** Token symbol shown in the UI, e.g. "TSLAx". */
  symbol: string;
  /** Underlying ticker, e.g. "TSLA". */
  ticker: string;
  /** Company or fund name, e.g. "Tesla". */
  name: string;
  decimals: number;
  /** Used for dollar labels only when the live price lookup fails. */
  fallbackPriceUsd: number;
  /** False for a stock that turned up on-chain but is not in the registry. */
  known: boolean;
  /**
   * Whether a narrative can convert into it on this cluster. Every listed
   * stock is available on mainnet; on devnet only the stand-in mints are.
   */
  available: boolean;
  icon?: string;
  /** Who issues the token: "xStock", "Ondo", "Backpack Securities", ... */
  issuer?: string;
  /** Redeemability as the Tokens API reports it, e.g. "cash_redeemable". */
  tier?: string;
  liquidityUsd?: number;
  /** Live USD price from the Tokens API, when it has one. */
  priceUsd?: number;
  change24hPercent?: number;
};

/** "TSLAx" -> "TSLA"; the issuer suffix is not part of the ticker. */
export function tickerOf(symbol: string): string {
  return symbol.replace(/x$/i, "");
}

/**
 * Stocks pinned through the environment.
 *
 * The registry itself comes from the Tokens API (see src/lib/stocks.ts and
 * /api/stocks). `NEXT_PUBLIC_STOCKS` is a comma-separated list of
 * `SYMBOL:mint[:decimals[:fallbackUsd]]` that overrides or extends it: on
 * devnet, where real tokenized stocks do not exist, it names the stand-in
 * mint for each symbol. If unset, the single-stock variables
 * (`NEXT_PUBLIC_STOCK_MINT` and friends) define one entry.
 */
function parseEnvStocks(): StockInfo[] {
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
        ticker: tickerOf(symbol),
        name: tickerOf(symbol),
        mint: address(mint),
        decimals: decimals ? Number(decimals) : 8,
        fallbackPriceUsd: price ? Number(price) : 100,
        known: true,
        available: true,
      });
    } catch {
      // A malformed entry should not take the app down.
    }
  }

  const single = process.env.NEXT_PUBLIC_STOCK_MINT ?? "";
  if (out.length === 0 && single) {
    const symbol = process.env.NEXT_PUBLIC_STOCK_SYMBOL ?? "TSLAx";
    out.push({
      symbol,
      ticker: tickerOf(symbol),
      name: tickerOf(symbol),
      mint: address(single),
      decimals: Number(process.env.NEXT_PUBLIC_STOCK_DECIMALS ?? 8),
      fallbackPriceUsd: Number(process.env.NEXT_PUBLIC_STOCK_PRICE_USD ?? 250),
      known: true,
      available: true,
    });
  }

  return out;
}

export const ENV_STOCKS: StockInfo[] = parseEnvStocks();

// The live registry. It starts as the environment's entries so the first
// render has something, and src/lib/stocks.ts replaces it once the Tokens
// API answers.
let registry: StockInfo[] = ENV_STOCKS;

/** Every stock the app knows about, available ones first. */
export function getStocks(): StockInfo[] {
  return registry;
}

export function setStocks(next: StockInfo[]): void {
  registry = next;
}

/** The stock a new narrative defaults to: the first one usable here. */
export function defaultStock(): StockInfo | null {
  return registry.find((s) => s.available) ?? null;
}

/**
 * Looks a stock up by mint. An unknown mint still renders — with its address
 * as the ticker and the decimals the narrative recorded on-chain.
 */
export function stockFor(mint: Address, decimals = 8): StockInfo {
  return (
    registry.find((s) => s.mint === mint) ?? {
      mint,
      symbol: shortAddress(mint),
      ticker: shortAddress(mint),
      name: shortAddress(mint),
      decimals,
      fallbackPriceUsd: 0,
      known: false,
      available: false,
    }
  );
}

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

/**
 * Dollar figure with sensible precision for small per-token prices. Under a
 * dollar, four decimals: the curve moves a token by fractions of a cent, and
 * two decimals would hide every buy.
 */
export function formatUsdAuto(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 1) return formatUsd(value, 4);
  return formatUsd(value, 2);
}

export function explorerUrl(addr: string): string {
  const cluster = CLUSTER === "mainnet" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/address/${addr}${cluster}`;
}
