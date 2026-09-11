/**
 * Which registry stocks a narrative may convert into on mainnet.
 *
 * No hand-kept list: a stock is pickable when (1) Jupiter can route a
 * roughly $100 buy into it that delivers at least 90% of its value at the
 * registry price (Jupiter's own `priceImpactPct` measures a pool's offset
 * from a reference price, not depth, and reads 2% on deep xStocks pools),
 * (2) its mint charges no transfer fee (the vault would receive less than the
 * curve records), and (3) its mint has no transfer hook enabled (an issuer's
 * hook could stall payouts). Everything else stays visible and lights up on its own once a
 * pool appears. `STOCK_DENY_LIST` (comma-separated mints or symbols) is the
 * emergency switch, the mirror of devnet's `NEXT_PUBLIC_STOCKS` pins.
 */

import { address, type Address } from "@solana/kit";
import { fetchAllMaybeMint } from "@solana-program/token-2022";

import { JUPITER_MAX_ACCOUNTS } from "../config";
import { rpc } from "./rpc";

/** Why a stock is not pickable, in the words the picker shows. */
export type NotTradable = "Not listed" | "Transfer fee" | "Transfer hook" | "No pool yet" | "Thin pool";

export type Tradability = { tradable: true } | { tradable: false; reason: NotTradable };

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const NO_HOOK = "11111111111111111111111111111111";

/** The buy the route must absorb, and the least of its value it must deliver. */
const PROBE_USD = 100;
const MIN_VALUE = 0.9;
/** Without a registry price to value the output, Jupiter's impact figure stands in. */
const MAX_IMPACT = 0.05;
/** Below this the Tokens API has seen no pool worth quoting. */
const MIN_LIQUIDITY_USD = 1_000;

/** Mint extensions almost never change; a route can appear any half hour. */
const MINT_TTL_MS = 60 * 60_000;
const ROUTE_TTL_MS = 30 * 60_000;
const CONCURRENCY = 4;
/**
 * The lite API is rate limited per IP (about 150 quotes in a few minutes
 * trips it, and the block lasts a few minutes). A cold cache gets a bigger
 * first pass; after that each pass refreshes only the stalest few, most
 * liquid first, and a 429 ends the pass and rests the probe.
 */
const PROBES_COLD = 60;
const PROBES_PER_PASS = 30;
const BACKOFF_MS = 3 * 60_000;

type MintFacts = { feeBps: number; hookEnabled: boolean };
type Cached<T> = { value: T; at: number };

const mintCache = new Map<string, Cached<MintFacts>>();
const routeCache = new Map<string, Cached<boolean | "thin">>();
let probeRestsUntil = 0;

function denied(): Set<string> {
  return new Set(
    (process.env.STOCK_DENY_LIST ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

async function readMints(mints: Address[]): Promise<void> {
  const now = Date.now();
  const stale = mints.filter((m) => now - (mintCache.get(m)?.at ?? 0) > MINT_TTL_MS);
  for (let i = 0; i < stale.length; i += 100) {
    const batch = stale.slice(i, i + 100);
    let accounts: Awaited<ReturnType<typeof fetchAllMaybeMint>>;
    try {
      accounts = await fetchAllMaybeMint(rpc, batch);
    } catch {
      continue; // Keep whatever was cached; the next pass retries.
    }
    accounts.forEach((account, j) => {
      const mint = batch[j];
      if (!account.exists) return;
      const ext = account.data.extensions.__option === "Some" ? account.data.extensions.value : [];
      let feeBps = 0;
      let hookEnabled = false;
      for (const e of ext) {
        if (e.__kind === "TransferFeeConfig") {
          feeBps = Math.max(e.olderTransferFee.transferFeeBasisPoints, e.newerTransferFee.transferFeeBasisPoints);
        } else if (e.__kind === "TransferHook") {
          hookEnabled = e.programId !== NO_HOOK;
        }
      }
      mintCache.set(mint, { value: { feeBps, hookEnabled }, at: now });
    });
  }
}

type Probe = { mint: string; decimals: number; priceUsd?: number };

/** What `lamports` of SOL buys, or false for no route, or null for no answer. */
async function quote(mint: string, lamports: number): Promise<{ out: number; impact: number } | false | null> {
  try {
    const url =
      `${JUPITER_QUOTE}?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${lamports}` +
      `&slippageBps=100&maxAccounts=${JUPITER_MAX_ACCOUNTS}`;
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 400) return false; // TOKEN_NOT_TRADABLE and friends: no route.
    if (response.status === 429) probeRestsUntil = Date.now() + BACKOFF_MS;
    if (!response.ok) return null; // Rate limited or down: keep the last answer.
    const body = (await response.json()) as { outAmount?: string; priceImpactPct?: string };
    if (!body.outAmount) return false;
    return { out: Number(body.outAmount), impact: Number(body.priceImpactPct ?? 0) };
  } catch {
    return null;
  }
}

function judge(p: Probe, found: { out: number; impact: number }, usdIn: number | null): boolean | "thin" {
  if (usdIn && p.priceUsd) {
    return (found.out / 10 ** p.decimals) * p.priceUsd >= MIN_VALUE * usdIn ? true : "thin";
  }
  return found.impact < MAX_IMPACT ? true : "thin";
}

/** `probes` come most liquid first, so a throttled pass refreshes the ones that matter. */
async function probeRoutes(probes: Probe[], lamports: number, usdIn: number | null): Promise<void> {
  const now = Date.now();
  if (now < probeRestsUntil) return;
  const stale = probes
    .filter((p) => now - (routeCache.get(p.mint)?.at ?? 0) > ROUTE_TTL_MS)
    .sort((a, b) => (routeCache.get(a.mint)?.at ?? 0) - (routeCache.get(b.mint)?.at ?? 0));
  const queue = stale.slice(0, routeCache.size === 0 ? PROBES_COLD : PROBES_PER_PASS);
  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() >= probeRestsUntil) {
      const p = queue[next++];
      const found = await quote(p.mint, lamports);
      if (found !== null) routeCache.set(p.mint, { value: found === false ? false : judge(p, found, usdIn), at: now });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/**
 * Applies the rules to a registry snapshot, most liquid first. `solUsd` sizes
 * the probe; without it a buy of one SOL stands in.
 */
export async function checkTradability(
  stocks: { mint: string; symbol: string; decimals: number; priceUsd?: number; liquidityUsd?: number }[],
  solUsd: number | null,
): Promise<Map<string, Tradability>> {
  const out = new Map<string, Tradability>();
  const deny = denied();
  const candidates: (Probe & { mint: Address; symbol: string; liquidityUsd?: number })[] = [];

  for (const s of stocks) {
    if (deny.has(s.mint.toUpperCase()) || deny.has(s.symbol.toUpperCase())) {
      out.set(s.mint, { tradable: false, reason: "Not listed" });
      continue;
    }
    try {
      candidates.push({ ...s, mint: address(s.mint) });
    } catch {
      out.set(s.mint, { tradable: false, reason: "Not listed" });
    }
  }

  await readMints(candidates.map((c) => c.mint));

  const toProbe: Probe[] = [];
  for (const c of candidates) {
    const facts = mintCache.get(c.mint)?.value;
    if (!facts) {
      out.set(c.mint, { tradable: false, reason: "No pool yet" });
    } else if (facts.feeBps > 0) {
      out.set(c.mint, { tradable: false, reason: "Transfer fee" });
    } else if (facts.hookEnabled) {
      out.set(c.mint, { tradable: false, reason: "Transfer hook" });
    } else if ((c.liquidityUsd ?? 0) < MIN_LIQUIDITY_USD) {
      out.set(c.mint, { tradable: false, reason: "No pool yet" });
    } else {
      toProbe.push({ mint: c.mint, decimals: c.decimals, priceUsd: c.priceUsd });
    }
  }

  const lamports = Math.round((solUsd ? PROBE_USD / solUsd : 1) * 1e9);
  await probeRoutes(toProbe, lamports, solUsd ? PROBE_USD : null);

  for (const { mint } of toProbe) {
    const route = routeCache.get(mint)?.value;
    if (route === true) out.set(mint, { tradable: true });
    else if (route === "thin") out.set(mint, { tradable: false, reason: "Thin pool" });
    else out.set(mint, { tradable: false, reason: "No pool yet" });
  }

  return out;
}
