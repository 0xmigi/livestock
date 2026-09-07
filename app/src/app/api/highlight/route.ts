/**
 * The best narrative trade of the last week, replayed from the chain.
 *
 * Every buy, sell and conversion touches the narrative account, so its
 * signature history is the whole trade log. Each trade moves the vault, and
 * the vault is denominated in the stock, so what each wallet paid and got
 * back is read straight off the token balance changes — in shares, which is
 * the only honest unit: it strips the stock's own price move out.
 *
 * "Best" is the round trip that turned the most stock into the most stock:
 * bought tokens, then sold them or was converted at expiry, and received
 * more of the underlying than it paid. That is the pitch, and it is either
 * on chain or it is not shown.
 */

import { NextResponse } from "next/server";
import { applyBps, fetchNarratives, netSellProceeds, spotPriceAt, stateAt, type Narrative } from "@nm/client";
import type { Address, Signature } from "@solana/kit";

import { rpc } from "@/lib/server/rpc";
import { assetIdForMint, fetchCandles } from "@/lib/server/tokens";

const WEEK = 7 * 24 * 3600;
const MAX_SIGNATURES = 1000;
const CACHE_MS = 60_000;

export type HighlightPoint = { t: number; spot: number };

/**
 * One moment of the trade, per $1,000 put in at the entry:
 * shares of the stock the narrative position would fetch if sold then,
 * shares the same money bought outright, and the stock's price then.
 */
export type SeriesPoint = { t: number; narrative: number; stock: number; price: number };

export type Highlight = {
  found: true;
  narrative: {
    address: Address;
    name: string;
    symbol: string;
    stockMint: Address;
    stockDecimals: number;
    createdTs: number;
    expiryTs: number;
    sellTaxBps: number;
  };
  /** Spot price over the week, in whole units of the stock per token. */
  points: HighlightPoint[];
  /** The trade, entry to exit, against the stock's own price. Empty without price history. */
  series: SeriesPoint[];
  trade: {
    owner: Address;
    tokens: number;
    /** Stock spent on those tokens, fee included, in whole units. */
    paid: number;
    /** Stock received when they left, in whole units. */
    received: number;
    boughtAt: number;
    exitedAt: number;
    exit: "sold" | "converted";
  };
  /** Distinct wallets that traded this narrative in the week. */
  traders: number;
};

/** Tokens a wallet bought together, and what each cost, fee included. */
type Lot = { t: number; tokens: bigint; cost: bigint };

/** One sale or conversion, matched first-in-first-out against the wallet's lots. */
type Exit = {
  owner: Address;
  t: number;
  tokens: bigint;
  /** What those tokens cost when bought. */
  cost: bigint;
  received: bigint;
  /** When the earliest of those tokens was bought. */
  boughtAt: number;
  kind: "sold" | "converted";
};

type Snapshot = { t: number; supply: bigint; owner: Address | null; delta: bigint };
type Replay = { points: HighlightPoint[]; traders: number; exits: Exit[]; snapshots: Snapshot[] };

let cached: { at: number; body: Highlight | { found: false } } | null = null;

function units(value: bigint | number, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

async function fetchTx(signature: string) {
  return rpc
    .getTransaction(signature as Signature, { maxSupportedTransactionVersion: 0, encoding: "json" })
    .send()
    .catch(() => null);
}

/** Walks a narrative's week of trades, oldest first. */
async function replay(address: Address, n: Narrative, since: number): Promise<Replay> {
  const sigs = await rpc.getSignaturesForAddress(address, { limit: MAX_SIGNATURES }).send();
  const recent = sigs
    .filter((s) => !s.err && s.blockTime !== null && s.blockTime !== undefined && Number(s.blockTime) >= since)
    .reverse();

  const txs: Awaited<ReturnType<typeof fetchTx>>[] = [];
  for (let i = 0; i < recent.length; i += 25) {
    txs.push(...(await Promise.all(recent.slice(i, i + 25).map((s) => fetchTx(s.signature)))));
  }

  const lots = new Map<Address, Lot[]>();
  const exits: Exit[] = [];
  const points: HighlightPoint[] = [];
  // Supply before the week: today's supply minus everything minted since.
  let minted = 0n;
  const deltas: { t: number; tokens: Map<Address, bigint>; vault: bigint }[] = [];

  for (let i = 0; i < txs.length; i++) {
    const meta = txs[i]?.meta;
    const t = Number(recent[i].blockTime);
    if (!meta) continue;
    const pre = new Map<number, { mint: string; owner?: string; amount: bigint }>();
    for (const b of meta.preTokenBalances ?? []) {
      pre.set(b.accountIndex, { mint: b.mint, owner: b.owner ?? undefined, amount: BigInt(b.uiTokenAmount.amount) });
    }
    const tokens = new Map<Address, bigint>();
    let vault = 0n;
    const seen = new Set<number>();
    for (const b of meta.postTokenBalances ?? []) {
      seen.add(b.accountIndex);
      const before = pre.get(b.accountIndex)?.amount ?? 0n;
      const delta = BigInt(b.uiTokenAmount.amount) - before;
      if (b.mint === n.narrativeMint && b.owner) {
        const owner = b.owner as Address;
        tokens.set(owner, (tokens.get(owner) ?? 0n) + delta);
      }
      if (b.mint === n.stockMint && b.owner === address) vault += delta;
    }
    for (const [index, b] of pre) {
      if (seen.has(index)) continue;
      if (b.mint === n.narrativeMint && b.owner) {
        const owner = b.owner as Address;
        tokens.set(owner, (tokens.get(owner) ?? 0n) - b.amount);
      }
    }
    for (const d of tokens.values()) minted += d;
    deltas.push({ t, tokens, vault });
  }

  let supply = n.supply - minted;
  if (supply < 0n) supply = 0n;
  const snapshots: Snapshot[] = [];
  // The chart starts where the narrative's week does: its launch, if later.
  points.push({ t: Math.max(since, Number(n.createdTs)), spot: units(spotPriceAt(n, n.supply, supply), n.stockDecimals) });

  for (const d of deltas) {
    for (const [owner, delta] of d.tokens) {
      if (delta === 0n) continue;
      const open = lots.get(owner) ?? [];
      if (delta > 0n) {
        // A buy: the vault took the cost; the creator's fee came on top.
        const cost = d.vault > 0n ? d.vault : 0n;
        open.push({ t: d.t, tokens: delta, cost: cost + applyBps(cost, n.feeBps) });
      } else {
        // A sell or a conversion: whatever left the vault went to them. Match
        // it against their oldest tokens first.
        let remaining = -delta;
        let cost = 0n;
        let boughtAt = d.t;
        while (remaining > 0n && open.length > 0) {
          const lot = open[0];
          boughtAt = Math.min(boughtAt, lot.t);
          const take = lot.tokens < remaining ? lot.tokens : remaining;
          cost += (lot.cost * take) / lot.tokens;
          lot.cost -= (lot.cost * take) / lot.tokens;
          lot.tokens -= take;
          remaining -= take;
          if (lot.tokens === 0n) open.shift();
        }
        if (cost > 0n) {
          exits.push({
            owner,
            t: d.t,
            tokens: -delta - remaining,
            cost,
            received: d.vault < 0n ? -d.vault : 0n,
            boughtAt,
            kind: d.t >= Number(n.expiryTs) ? "converted" : "sold",
          });
        }
      }
      lots.set(owner, open);
      supply += delta;
      snapshots.push({ t: d.t, supply: supply < 0n ? 0n : supply, owner, delta });
    }
    // Conversions after expiry burn the supply but are not price moves.
    if (d.t < Number(n.expiryTs)) {
      points.push({ t: d.t, spot: units(spotPriceAt(n, n.supply, supply < 0n ? 0n : supply), n.stockDecimals) });
    }
  }
  const end = Math.min(Math.floor(Date.now() / 1000), Number(n.expiryTs));
  points.push({ t: end, spot: points[points.length - 1].spot });

  return { points, traders: lots.size, exits, snapshots };
}

/** Per $1,000 at the entry price: how many shares that is. */
const STAKE = 1_000;

/**
 * The winner's trade as two share counts over time. The narrative line is
 * what their tokens would have fetched if sold at each moment — the sell
 * formula at the supply then, tax off — and ends just before their exit, at
 * the supply they actually sold into. The stock line is the same money in
 * shares, which never changes; the price beside each point is what moves
 * both lines in dollars.
 */
async function buildSeries(n: Narrative, snapshots: Snapshot[], exit: Exit): Promise<SeriesPoint[]> {
  const assetId = await assetIdForMint(n.stockMint);
  if (!assetId) return [];
  const t0 = exit.boughtAt;
  const t1 = exit.t;
  const owner = exit.owner;
  const costOfExited = exit.cost;
  const candles = await fetchCandles(assetId, t0 - 3600, t1 + 60);
  if (candles.length === 0) return [];
  const priceAt = (t: number) => {
    let price = candles[0].close;
    for (const c of candles) if (c.time <= t) price = c.close;
    return price;
  };
  const entryPrice = priceAt(t0);
  const stockShares = STAKE / entryPrice;
  const tokens = exit.tokens;

  // The supply in effect at each moment of the trade, stopping before the exit.
  const stops: { t: number; supply: bigint }[] = [];
  for (const s of snapshots) {
    if (s.t < t0) continue;
    if (s.t >= t1 && s.owner === owner && s.delta < 0n) break;
    if (s.t > t1) break;
    stops.push({ t: s.t, supply: s.supply });
  }
  if (stops.length === 0) return [];
  const supplyAt = (t: number) => {
    let supply = stops[0].supply;
    for (const s of stops) if (s.t <= t) supply = s.supply;
    return supply;
  };
  const narrativeShares = (supply: bigint) => {
    if (tokens > supply || tokens === 0n) return 0;
    const proceeds = netSellProceeds(stateAt(n, n.supply, supply), tokens, n.sellTaxBps);
    return (Number(proceeds) / Number(costOfExited)) * stockShares;
  };

  const times = new Set<number>([t0, t1]);
  for (const s of stops) times.add(s.t);
  for (const c of candles) if (c.time > t0 && c.time < t1) times.add(c.time);
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({ t, narrative: narrativeShares(supplyAt(t)), stock: stockShares, price: priceAt(t) }));
}

/** Narratives replayed at once. Each is a burst of RPC calls. */
const PARALLEL = 4;

async function compute(): Promise<Highlight | { found: false }> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - WEEK;
  let best: { score: number; body: Highlight } | null = null;

  const entries = await fetchNarratives(rpc);
  const replays: { entry: (typeof entries)[number]; result: Replay }[] = [];
  for (let i = 0; i < entries.length; i += PARALLEL) {
    const chunk = entries.slice(i, i + PARALLEL);
    const results = await Promise.all(chunk.map((entry) => replay(entry.address, entry.narrative, since)));
    results.forEach((result, j) => replays.push({ entry: chunk[j], result }));
  }

  let winner: { entry: (typeof entries)[number]; result: Replay; exit: Exit } | null = null;
  for (const { entry, result } of replays) {
    const n = entry.narrative;
    for (const exit of result.exits) {
      if (exit.tokens === 0n || exit.cost === 0n) continue;
      const score = Number(exit.received) / Number(exit.cost);
      // Only a trade that came out ahead in shares is a story worth telling.
      if (score <= 1) continue;
      if (!best || score > best.score) {
        winner = { entry, result, exit };
        best = {
          score,
          body: {
            found: true,
            narrative: {
              address: entry.address,
              name: n.name,
              symbol: n.symbol,
              stockMint: n.stockMint,
              stockDecimals: n.stockDecimals,
              createdTs: Number(n.createdTs),
              expiryTs: Number(n.expiryTs),
              sellTaxBps: n.sellTaxBps,
            },
            points: result.points,
            series: [],
            trade: {
              owner: exit.owner,
              tokens: Number(exit.tokens),
              paid: units(exit.cost, n.stockDecimals),
              received: units(exit.received, n.stockDecimals),
              boughtAt: exit.boughtAt,
              exitedAt: exit.t,
              exit: exit.kind,
            },
            traders: result.traders,
          },
        };
      }
    }
  }

  if (!best || !winner) return { found: false };
  try {
    best.body.series = await buildSeries(winner.entry.narrative, winner.result.snapshots, winner.exit);
  } catch {
    // No price history is a duller card, not a broken one.
  }
  return best.body;
}

export async function GET() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    try {
      cached = { at: Date.now(), body: await compute() };
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 502 });
    }
  }
  return NextResponse.json(cached.body, { headers: { "Cache-Control": "public, s-maxage=60" } });
}
