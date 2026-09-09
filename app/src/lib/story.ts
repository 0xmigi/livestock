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
