/**
 * Mirror of `programs/livestock/src/curve.rs`: the pump.fun bonding
 * curve, denominated in the stock.
 *
 * Kept in lockstep with the on-chain math so the UI can quote a buy without a
 * simulation round-trip. Every value is a bigint in **stock base units**;
 * narrative mints have 0 decimals, so token counts are plain integers.
 *
 * A curve is two virtual reserves. Their product is (near enough) constant:
 *
 *   buy  n tokens:  cost   = n × virtualStock / (virtualTokens − n) + 1
 *   sell n tokens:  refund = n × virtualStock / (virtualTokens + n)
 *   spot price     = virtualStock / virtualTokens
 *
 * The token side opens at pump.fun's numbers, in whole tokens. The stock side
 * opens at what 30 SOL is worth in the stock, pump.fun's initial virtual SOL.
 */

export const BPS_DENOMINATOR = 10_000n;

/**
 * Narrative mints carry **0 decimals** — one token is one integer unit.
 *
 * Launchpad convention is 6, and this deviates on purpose: the reserves are
 * pump.fun's counted in whole tokens, a billion of which is plenty of
 * granularity, and whole units keep every price an exact ratio of two
 * integers with no decimal scaling anywhere.
 */
export const NARRATIVE_DECIMALS = 0;

/** pump.fun's `initial_virtual_token_reserves`, in whole tokens. */
export const INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000n;
/** pump.fun's `initial_real_token_reserves`: all the curve will ever sell. */
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000n;
/** pump.fun's `token_total_supply`, the figure market cap is quoted against. */
export const TOKEN_TOTAL_SUPPLY = 1_000_000_000n;
/** pump.fun's `initial_virtual_sol_reserves`, in SOL. */
export const INITIAL_VIRTUAL_SOL = 30;

/** The curve's live reserves, as stored on a narrative. */
export type CurveState = {
  virtualStock: bigint;
  virtualTokens: bigint;
};

/**
 * The opening stock reserve for a new narrative: 30 SOL, in the stock.
 *
 * This is the one curve parameter a creator supplies. It fixes the opening
 * price — 30 SOL spread over 1.073 billion tokens — so a fresh narrative
 * opens at pump.fun's market cap whatever the stock trades at.
 */
export function initialVirtualStock(
  solPriceUsd: number,
  stockPriceUsd: number,
  stockDecimals: number,
): bigint {
  return usdToStock(INITIAL_VIRTUAL_SOL * solPriceUsd, stockPriceUsd, stockDecimals);
}

/** Tokens still for sale before the curve is sold out. */
export function remaining(supply: bigint): bigint {
  const left = INITIAL_REAL_TOKEN_RESERVES - supply;
  return left > 0n ? left : 0n;
}

/**
 * Stock owed to buy `amount` tokens, matching `buy_cost`: rounded up by one
 * base unit, as pump.fun does.
 */
export function buyCost(state: CurveState, amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  if (amount >= state.virtualTokens) throw new Error("more tokens than the curve holds");
  return (amount * state.virtualStock) / (state.virtualTokens - amount) + 1n;
}

/** Stock returned for selling `amount` tokens, matching `sell_refund`. */
export function sellRefund(state: CurveState, amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  return (amount * state.virtualStock) / (state.virtualTokens + amount);
}

/** The reserves after a buy of `amount`. */
export function afterBuy(state: CurveState, amount: bigint): CurveState {
  const cost = buyCost(state, amount);
  return {
    virtualStock: state.virtualStock + cost,
    virtualTokens: state.virtualTokens - amount,
  };
}

/** The reserves after a sell of `amount`. */
export function afterSell(state: CurveState, amount: bigint): CurveState {
  const refund = sellRefund(state, amount);
  return {
    virtualStock: state.virtualStock - refund,
    virtualTokens: state.virtualTokens + amount,
  };
}

/**
 * Marginal price of the next token, in stock base units — fractional, since
 * one token is usually a fraction of a base unit on this curve.
 */
export function spotPrice(state: CurveState): number {
  if (state.virtualTokens === 0n) return 0;
  return Number(state.virtualStock) / Number(state.virtualTokens);
}

/**
 * The reserves the curve would hold at some other supply, walked along the
 * constant product from where it is now.
 *
 * Exact up to the one-unit rounding each trade adds, which is all the UI
 * needs to replay a price history or preview a curve.
 */
export function stateAt(
  state: CurveState,
  currentSupply: bigint,
  supply: bigint,
): CurveState {
  const virtualTokens = state.virtualTokens + currentSupply - supply;
  if (virtualTokens <= 0n) throw new Error("supply exceeds the curve");
  const k = state.virtualStock * state.virtualTokens;
  return { virtualStock: k / virtualTokens, virtualTokens };
}

/** Marginal price at some other supply. See `stateAt`. */
export function spotPriceAt(
  state: CurveState,
  currentSupply: bigint,
  supply: bigint,
): number {
  return spotPrice(stateAt(state, currentSupply, supply));
}

/** The opening reserves of a narrative with this stock-side parameter. */
export function openingState(virtualStock: bigint): CurveState {
  return { virtualStock, virtualTokens: INITIAL_VIRTUAL_TOKEN_RESERVES };
}

export function applyBps(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / BPS_DENOMINATOR;
}

/** Total stock a buyer parts with for `amount` tokens: curve cost plus fee. */
export function totalBuyCost(
  state: CurveState,
  amount: bigint,
  feeBps: number,
): bigint {
  const cost = buyCost(state, amount);
  return cost + applyBps(cost, feeBps);
}

/** Stock a seller receives for `amount` tokens, after the tax. */
export function netSellProceeds(
  state: CurveState,
  amount: bigint,
  sellTaxBps: number,
): bigint {
  const refund = sellRefund(state, amount);
  return refund - applyBps(refund, sellTaxBps);
}

/**
 * Most tokens buyable for `stockIn` base units, fee included, and never more
 * than the curve has left to sell.
 *
 * The instruction takes an exact token amount, so the UI inverts the cost
 * curve here. Binary search rather than the closed form: it stays exact in
 * bigint arithmetic and cannot drift from `totalBuyCost` by a rounding step,
 * which would surface to the user as a confusing slippage failure.
 */
export function tokensForStock(
  state: CurveState,
  supply: bigint,
  stockIn: bigint,
  feeBps: number,
): bigint {
  const cap = remaining(supply);
  if (stockIn <= 0n || cap === 0n) return 0n;
  if (totalBuyCost(state, 1n, feeBps) > stockIn) return 0n;
  if (totalBuyCost(state, cap, feeBps) <= stockIn) return cap;

  let low = 1n;
  let high = cap;
  while (low < high - 1n) {
    const mid = (low + high) / 2n;
    if (totalBuyCost(state, mid, feeBps) <= stockIn) {
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
  baseUnits: bigint | number,
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
