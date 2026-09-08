/**
 * The stock registry, from the Tokens API (https://docs.tokens.xyz).
 *
 * The API lists every tokenized equity on Solana with its canonical mint,
 * so the app never carries a hand-typed list of stocks. The key is server-side
 * only, which is why the browser reads this route rather than the API.
 *
 * Nothing on-chain depends on what comes back: a narrative records its stock
 * mint and decimals itself. This list decides what the picker offers and what
 * the dollar labels say.
 */

import { NextResponse } from "next/server";

const TOKENS_API = "https://api.tokens.xyz/v1";

/** Curated lists to merge, in priority order. `stocks` already has the ETFs people ask for; `etfs` adds the rest. */
const LISTS = ["stocks", "etfs"];

/** How long a fetched list is reused before the API is asked again. */
const REVALIDATE_SECONDS = 60;

/** One stock as the browser sees it. */
export type StockListing = {
  assetId: string;
  /** Variant symbol, e.g. "TSLAx". */
  symbol: string;
  /** Underlying ticker, e.g. "TSLA". */
  ticker: string;
  /** Company or fund name. */
  name: string;
  mint: string;
  decimals: number;
  /** Who issues the token: "xStock", "Ondo", "Backpack Securities", ... */
  issuer?: string;
  /** Redeemability as the API reports it, e.g. "cash_redeemable". */
  tier?: string;
  icon?: string;
  priceUsd?: number;
  change24hPercent?: number;
  liquidityUsd?: number;
  /** Market cap of the token on Solana, not of the company. */
  marketCapUsd?: number;
  holders?: number;
};

type ApiVariant = {
  mint?: string;
  symbol?: string;
  label?: string;
  stockVariantTier?: string;
  market?: {
    decimals?: number;
    price?: number;
    liquidity?: number;
    marketCap?: number;
    holder?: number;
    priceChange24hPercent?: number;
    logoURI?: string;
  } | null;
};

type ApiAsset = {
  assetId?: string;
  symbol?: string;
  name?: string;
  imageUrl?: string;
  stats?: {
    price?: number;
    liquidity?: number;
    priceChange24hPercent?: number;
  } | null;
  primaryVariant?: ApiVariant | null;
};

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalize(asset: ApiAsset): StockListing | null {
  const v = asset.primaryVariant;
  const mint = str(v?.mint);
  const ticker = str(asset.symbol);
  const assetId = str(asset.assetId);
  // Decimals drive the curve maths on Create; a listing without them is not
  // safe to offer.
  const decimals = num(v?.market?.decimals);
  if (!v || !mint || !ticker || !assetId || decimals === undefined) return null;

  return {
    assetId,
    symbol: str(v.symbol) ?? ticker,
    ticker,
    name: str(asset.name) ?? ticker,
    mint,
    decimals,
    issuer: str(v.label),
    tier: str(v.stockVariantTier),
    icon: str(asset.imageUrl) ?? str(v.market?.logoURI),
    priceUsd: num(asset.stats?.price) ?? num(v.market?.price),
    change24hPercent: num(asset.stats?.priceChange24hPercent) ?? num(v.market?.priceChange24hPercent),
    liquidityUsd: num(asset.stats?.liquidity) ?? num(v.market?.liquidity),
    // `stats.marketCap` is the company's; the variant's is the token's.
    marketCapUsd: num(v.market?.marketCap),
    holders: num(v.market?.holder),
  };
}

/** SOL in USD, so the buy panel can size a purchase in SOL. */
async function fetchSolUsd(key: string): Promise<number | null> {
  try {
    const response = await fetch(`${TOKENS_API}/assets/sol`, {
      headers: { "x-api-key": key },
      next: { revalidate: 30 },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { asset?: { stats?: { price?: number } } };
    return num(body.asset?.stats?.price) ?? null;
  } catch {
    return null;
  }
}

async function fetchList(list: string, key: string): Promise<ApiAsset[]> {
  const response = await fetch(`${TOKENS_API}/assets/curated?list=${list}`, {
    headers: { "x-api-key": key },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!response.ok) {
    throw new Error(`Tokens API returned ${response.status} for the ${list} list.`);
  }
  const body = (await response.json()) as { assets?: unknown };
  return Array.isArray(body.assets) ? (body.assets as ApiAsset[]) : [];
}

export async function GET() {
  const key = process.env.TOKENS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "TOKENS_API_KEY is not set. Add it to app/.env.local to load the stock list." },
      { status: 501 },
    );
  }

  try {
    const [solUsd, ...lists] = await Promise.all([
      fetchSolUsd(key),
      ...LISTS.map((list) => fetchList(list, key)),
    ]);

    // One entry per mint; the first list to mention a mint wins.
    const byMint = new Map<string, StockListing>();
    for (const assets of lists) {
      for (const asset of assets) {
        const listing = normalize(asset);
        if (listing && !byMint.has(listing.mint)) byMint.set(listing.mint, listing);
      }
    }

    const stocks = [...byMint.values()].sort(
      (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
    );

    return NextResponse.json(
      { stocks, solUsd, fetchedAt: Date.now() },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=300`,
        },
      },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
