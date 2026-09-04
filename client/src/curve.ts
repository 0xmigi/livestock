/**
 * Mirror of `programs/narrative_markets/src/curve.rs`.
 *
 * Kept in lockstep with the on-chain math so the UI can quote a buy without a
 * simulation round-trip. Every value is a bigint in **stock base units**;
 * narrative mints have 0 decimals, so token counts are plain integers.
 */

export const BPS_DENOMINATOR = 10_000n;

/**
 * Narrative mints carry **0 decimals** — one token is one integer unit.
 *
 * Launchpad convention is 6, and this deviates on purpose. Over a 6-decimal
 * supply a linear slope is a fraction far below 1 and floors to zero in
 * integer arithmetic; scaling it back reintroduces a division whose flooring
 * can make marginal price equal average. "Marginal strictly exceeds average"
 * is what makes buying and immediately redeeming always a loss, so whole units
 * win over matching the convention here.
 */
export const NARRATIVE_DECIMALS = 0;

/** Curve parameters, as stored on a narrative. */
export type CurveParams = {
  basePrice: bigint;
  slope: bigint;
};

/**
 * Cost of `amount` tokens starting at `fromSupply`, in stock base units.
 *
 * The exact integral, matching `cost_of_range`: splitting a buy costs the same
 * as making it in one go.
 */
export function costOfRange(
  fromSupply: bigint,
  amount: bigint,
  { basePrice, slope }: CurveParams,
): bigint {
  if (amount <= 0n) return 0n;
  const triangular = (amount * (amount - 1n)) / 2n;
  return basePrice * amount + slope * (fromSupply * amount + triangular);
}

export function buyCost(
  supply: bigint,
  amount: bigint,
  params: CurveParams,
): bigint {
  return costOfRange(supply, amount, params);
}

export function sellRefund(
  supply: bigint,
  amount: bigint,
  params: CurveParams,
): bigint {
  if (amount > supply) throw new Error("cannot sell more than the supply");
  return costOfRange(supply - amount, amount, params);
}

/** Marginal price of the next token. */
export function spotPrice(supply: bigint, { basePrice, slope }: CurveParams): bigint {
  return basePrice + slope * supply;
}

export function applyBps(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / BPS_DENOMINATOR;
}

/** Total stock a buyer parts with for `amount` tokens: curve cost plus fee. */
export function totalBuyCost(
  supply: bigint,
  amount: bigint,
  params: CurveParams,
  feeBps: number,
): bigint {
  const cost = buyCost(supply, amount, params);
  return cost + applyBps(cost, feeBps);
}

/** Stock a seller receives for `amount` tokens, after the tax. */
export function netSellProceeds(
  supply: bigint,
  amount: bigint,
  params: CurveParams,
  sellTaxBps: number,
): bigint {
  const refund = sellRefund(supply, amount, params);
  return refund - applyBps(refund, sellTaxBps);
}

/**
 * Most tokens buyable for `stockIn` base units, fee included.
 *
 * The instruction takes an exact token amount, so the UI inverts the cost
 * curve here. Binary search rather than the quadratic formula: it stays exact
 * in bigint arithmetic and cannot drift from `totalBuyCost` by a rounding step,
 * which would surface to the user as a confusing slippage failure.
 */
export function tokensForStock(
  supply: bigint,
  stockIn: bigint,
  params: CurveParams,
  feeBps: number,
): bigint {
  if (stockIn <= 0n) return 0n;
  if (totalBuyCost(supply, 1n, params, feeBps) > stockIn) return 0n;

  let low = 1n;
  let high = 2n;
  while (totalBuyCost(supply, high, params, feeBps) <= stockIn) {
    low = high;
    high *= 2n;
  }

  while (low < high - 1n) {
    const mid = (low + high) / 2n;
    if (totalBuyCost(supply, mid, params, feeBps) <= stockIn) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

/** Pro-rata share of `pot` owed to `tokens` out of `supply`, rounded down. */
export function proRata(pot: bigint, tokens: bigint, supply: bigint): bigint {
  if (supply === 0n) return 0n;
  return (pot * tokens) / supply;
}

// --- formatting -----------------------------------------------------------

/** Formats stock base units for display. xStocks carry 8 decimals. */
export function formatStock(
  baseUnits: bigint,
  decimals = 8,
  places = 4,
): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = baseUnits / divisor;
  const frac = (baseUnits % divisor).toString().padStart(decimals, "0");
  const shown = frac.slice(0, places);
  return places > 0
    ? `${whole.toLocaleString()}.${shown}`
    : whole.toLocaleString();
}

/** Converts stock base units to a dollar figure at a given stock price. */
export function stockToUsd(
  baseUnits: bigint,
  stockPriceUsd: number,
  decimals = 8,
): number {
  return (Number(baseUnits) / 10 ** decimals) * stockPriceUsd;
}

/** Converts a dollar figure into stock base units at a given stock price. */
export function usdToStock(
  usd: number,
  stockPriceUsd: number,
  decimals = 8,
): bigint {
  if (stockPriceUsd <= 0) return 0n;
  return BigInt(Math.floor((usd / stockPriceUsd) * 10 ** decimals));
}
