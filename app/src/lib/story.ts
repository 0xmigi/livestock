/**
 * The example narrative's life, as numbers: the seeded walk behind the
 * hero's animation and the stills on the how-it-works page. Both read from
 * here, so they always tell the same story.
 */

/** Same $100 into each, so the two lines are directly comparable. */
export const STAKE = 100;
/** The creator's fee on every buy, as in the program (FEE_BPS = 100). */
export const FEE = 0.01;
/** One loop, in seconds. */
export const LOOP_SECS = 30;
/** When the post lands and the narrative launches. */
export const LAUNCH_AT = 6;
/** When the narrative expires into the stock. */
export const EXPIRY_AT = 21;
export const TICK_MS = 120;
/** The y-range is pinned (96 to 150 on a $100 stake) so the stock's few-percent day is drawn at its true size. */
export const RANGE_MIN = 96;
export const RANGE_MAX = 150;

export const STOCK = "TSLAx";
export const NARRATIVE = "$ROBOTAXI";
export const POST = { name: "Elon Musk", handle: "@elonmusk", text: "Robotaxi nationwide. Soon." };

/**
 * Seeded, so the chart is the same picture every loop. A different chart
 * each time reads as noise; the same one reads as the story.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const SEED = 12;

/** A random walk with a drift, in fractions per tick. */
export function step(random: () => number, value: number, drift: number, noise: number): number {
  return value * (1 + drift + (random() - 0.5) * noise);
}

export interface StoryTick {
  /** Seconds into the loop. */
  t: number;
  stock: number;
  /** Null before launch and after expiry. */
  narrative: number | null;
}

export interface Story {
  ticks: StoryTick[];
  /** What the $100 in the narrative redeems for at expiry, over a straight buy of the stock. */
  multiple: number;
}

/**
 * The whole loop, tick by tick, walked exactly as the animation walks it
 * (same draws from the same generator in the same order), so a still taken
 * from here is a frame of the animation.
 */
export function simulate(): Story {
  const random = rng(SEED);
  const launch = (LAUNCH_AT * 1000) / TICK_MS;
  const expiry = (EXPIRY_AT * 1000) / TICK_MS;
  const loop = (LOOP_SECS * 1000) / TICK_MS;
  let stockValue = STAKE;
  let anchor = STAKE;
  let narrativeValue = STAKE;
  let ratioSum = 0;
  let ratioCount = 0;
  const ticks: StoryTick[] = [];
  for (let tick = 1; tick <= loop; tick++) {
    // The stock has a normal day: it wanders a few percent but is pulled
    // back toward a barely drifting anchor. A small bump when the post lands.
    anchor *= 1 + 0.00003;
    const pull = ((anchor - stockValue) / stockValue) * 0.04;
    const bump = tick >= launch && tick < launch + 12 ? 0.0035 : 0;
    stockValue = step(random, stockValue, pull + bump, 0.013);

    let narrative: number | null = null;
    if (tick >= launch && tick < expiry) {
      if (tick === launch) {
        // Launch: the narrative starts at exactly the stock's price.
        narrativeValue = stockValue;
      } else {
        // Then runs hot while the story is fresh, dwindles as it ages, and
        // sells off into expiry. A leveraged story with a clock on it.
        const age = (tick - launch) / (expiry - launch);
        const drift = age < 0.55 ? 0.0065 : age < 0.8 ? -0.0005 : -0.003;
        narrativeValue = step(random, narrativeValue, drift, 0.014);
      }
      narrative = narrativeValue;
      ratioSum += narrativeValue / stockValue;
      ratioCount += 1;
    }
    ticks.push({ t: (tick * TICK_MS) / 1000, stock: stockValue, narrative });
  }
  // A token redeems for its share of the vault, which holds what every buyer
  // paid in less the fee: the average price paid, not the last price.
  return { ticks, multiple: (1 - FEE) * (ratioSum / ratioCount) };
}

// --- a story, as the animation plays it ------------------------------------

/**
 * Everything the hero's animation needs to play one narrative's life: the
 * seeded example, or a real trade read from the chain and laid onto the
 * same clock. Ticks are one per `TICK_MS`; the narrative launches at
 * `launchAt` seconds and ends at `expiryAt`, and the loop restarts at
 * `loopSecs`.
 */
export interface StoryDef {
  ticks: StoryTick[];
  launchAt: number;
  expiryAt: number;
  loopSecs: number;
  /** The chart's pinned y-range, in dollars on a $100 stake. */
  range: [number, number];
  stock: { symbol: string };
  narrative: { symbol: string; name: string };
  /** What $100 in the narrative came out to over $100 in the stock, or null while unknown. */
  multiple: number | null;
  /** The second beat: the post the example narrative launched on, or who made the trade. */
  beat:
    | { kind: "post"; post: { name: string; handle: string; text: string } }
    | { kind: "trade"; owner: string; exit: "sold" | "converted"; duration: string };
  /** The small caption in the corner: "example", "best trade this week". */
  label: string;
}

/** The seeded example. */
export function exampleStory(): StoryDef {
  const story = simulate();
  return {
    ticks: story.ticks,
    launchAt: LAUNCH_AT,
    expiryAt: EXPIRY_AT,
    loopSecs: LOOP_SECS,
    range: [RANGE_MIN, RANGE_MAX],
    stock: { symbol: STOCK },
    narrative: { symbol: NARRATIVE, name: NARRATIVE },
    multiple: story.multiple,
    beat: { kind: "post", post: POST },
    label: "example",
  };
}

/** One moment of a real trade: shares per $1,000 in the narrative (null outside the trade) and in the stock, and the stock's price. */
export interface TradePoint {
  t: number;
  narrative: number | null;
  stock: number;
  price: number;
}

export interface TradeInput {
  series: TradePoint[];
  boughtAt: number;
  exitedAt: number;
  exit: "sold" | "converted";
  owner: string;
  /** Stock received over stock paid, in shares. */
  multiple: number;
  stockSymbol: string;
  narrativeSymbol: string;
  narrativeName: string;
  /** The narrative's whole life, in seconds. */
  durationSecs: number;
}

function humanDuration(secs: number): string {
  const days = secs / 86_400;
  if (days >= 13) return `${Math.round(days / 7)}-week`;
  if (days >= 1.5) return `${Math.round(days)}-day`;
  const hours = Math.round(secs / 3600);
  return `${Math.max(1, hours)}-hour`;
}

/**
 * A real trade on the example's clock. The trade's own span, entry to exit,
 * fills the live phase; the stock's price just before entry and after exit
 * fills the phases either side, so the story plays the same way whether it
 * lasted an hour or a month. Values are dollars on $100 in at the entry.
 * Null when the series cannot carry it.
 */
export function tradeStory(input: TradeInput): StoryDef | null {
  const t0 = input.boughtAt;
  const t1 = input.exitedAt;
  const pts = input.series.filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.t - b.t);
  if (t1 <= t0 || pts.length < 2 || !pts.some((p) => p.t <= t0) || !pts.some((p) => p.t >= t1)) return null;

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  const at = (t: number): TradePoint => {
    if (t <= pts[0].t) return pts[0];
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1];
    let i = 1;
    while (pts[i].t < t) i++;
    const a = pts[i - 1];
    const b = pts[i];
    const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    const narrative = a.narrative !== null && b.narrative !== null ? lerp(a.narrative, b.narrative, f) : (b.narrative ?? a.narrative);
    return { t, narrative, stock: b.stock, price: lerp(a.price, b.price, f) };
  };

  const entry = at(t0);
  const stockShares = entry.stock;
  if (!(stockShares > 0) || !(entry.price > 0)) return null;
  const stockUsd = (p: TradePoint) => (STAKE * p.price) / entry.price;
  const narrativeUsd = (p: TradePoint) => (p.narrative === null ? null : (STAKE * (p.narrative / stockShares) * p.price) / entry.price);

  const preSpan = Math.max(0, t0 - pts[0].t);
  const postSpan = Math.max(0, pts[pts.length - 1].t - t1);
  const loop = (LOOP_SECS * 1000) / TICK_MS;
  const launch = (LAUNCH_AT * 1000) / TICK_MS;
  const expiry = (EXPIRY_AT * 1000) / TICK_MS;

  const ticks: StoryTick[] = [];
  for (let tick = 1; tick <= loop; tick++) {
    let t: number;
    let live = false;
    if (tick < launch) {
      t = t0 - preSpan + ((tick - 1) / (launch - 1)) * preSpan;
    } else if (tick < expiry) {
      t = t0 + ((tick - launch) / (expiry - 1 - launch)) * (t1 - t0);
      live = true;
    } else {
      t = t1 + ((tick - expiry) / (loop - expiry)) * postSpan;
    }
    const p = at(t);
    ticks.push({ t: (tick * TICK_MS) / 1000, stock: stockUsd(p), narrative: live ? narrativeUsd(p) : null });
  }

  const values = ticks.flatMap((k) => (k.narrative === null ? [k.stock] : [k.stock, k.narrative]));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return {
    ticks,
    launchAt: LAUNCH_AT,
    expiryAt: EXPIRY_AT,
    loopSecs: LOOP_SECS,
    range: [Math.min(RANGE_MIN, Math.floor(lo * 0.98)), Math.max(RANGE_MAX, Math.ceil(hi * 1.02))],
    stock: { symbol: input.stockSymbol },
    narrative: { symbol: input.narrativeSymbol, name: input.narrativeName },
    multiple: input.multiple,
    beat: { kind: "trade", owner: input.owner, exit: input.exit, duration: humanDuration(input.durationSecs) },
    label: "best trade this week",
  };
}
