//! Linear bonding curve, denominated in **stock base units**.
//!
//! ```text
//! price(supply) = base_price + slope * supply
//! ```
//!
//! Narrative mints have 0 decimals, so `supply` is both the raw mint supply and
//! the human-readable token count.
//!
//! # Why the stock, and not USDC
//!
//! Buyers pay dollars, but the curve is priced in the stock the narrative
//! expires into. This is load-bearing, not a detail.
//!
//! Redemption pays `vault / supply` — the curve's *average* price. A buy costs
//! the *marginal* price. On a rising curve marginal > average always, so minting
//! and immediately redeeming is always a loss and the arbitrage is closed.
//!
//! Price the curve in USDC instead and that stops holding: redemption value
//! becomes `(vault_stock / supply) * stock_price`, which moves with the stock,
//! while the curve's dollar price does not. Once the stock rallies past
//! `marginal / average` — a ratio near 1 for any curve with a real base price —
//! anyone can mint and redeem risk-free, diluting every holder to do it.

use crate::error::MarketError;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Cost, in stock base units, of the `amount` tokens starting at `from_supply`.
///
/// The exact integral of the curve over `[from_supply, from_supply + amount)`:
///
/// ```text
/// base * amount + slope * (from_supply * amount + amount * (amount - 1) / 2)
/// ```
///
/// A buy passes the current supply; a sell passes `supply - amount`, so both
/// directions price the same band identically and the curve stays solvent.
pub fn cost_of_range(
    from_supply: u64,
    amount: u64,
    base_price: u64,
    slope: u64,
) -> Result<u64, MarketError> {
    if amount == 0 {
        return Err(MarketError::ZeroAmount);
    }

    let from_supply = from_supply as u128;
    let amount = amount as u128;

    // Exact: one of `amount` and `amount - 1` is always even.
    let triangular = amount
        .checked_mul(amount - 1)
        .ok_or(MarketError::MathOverflow)?
        / 2;

    let linear = from_supply
        .checked_mul(amount)
        .ok_or(MarketError::MathOverflow)?;

    let slope_term = (slope as u128)
        .checked_mul(
            linear
                .checked_add(triangular)
                .ok_or(MarketError::MathOverflow)?,
        )
        .ok_or(MarketError::MathOverflow)?;

    let base_term = (base_price as u128)
        .checked_mul(amount)
        .ok_or(MarketError::MathOverflow)?;

    let total = base_term
        .checked_add(slope_term)
        .ok_or(MarketError::MathOverflow)?;

    u64::try_from(total).map_err(|_| MarketError::MathOverflow)
}

/// Stock owed to buy `amount` tokens at the current `supply`.
pub fn buy_cost(
    supply: u64,
    amount: u64,
    base_price: u64,
    slope: u64,
) -> Result<u64, MarketError> {
    cost_of_range(supply, amount, base_price, slope)
}

/// Stock returned for selling `amount` tokens back down from `supply`.
pub fn sell_refund(
    supply: u64,
    amount: u64,
    base_price: u64,
    slope: u64,
) -> Result<u64, MarketError> {
    let from = supply.checked_sub(amount).ok_or(MarketError::MathOverflow)?;
    cost_of_range(from, amount, base_price, slope)
}

/// Marginal price of the next token.
pub fn spot_price(supply: u64, base_price: u64, slope: u64) -> Result<u64, MarketError> {
    (slope as u128)
        .checked_mul(supply as u128)
        .and_then(|v| v.checked_add(base_price as u128))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(MarketError::MathOverflow)
}

/// `value * bps / 10_000`, rounded down.
pub fn apply_bps(value: u64, bps: u16) -> Result<u64, MarketError> {
    let out = (value as u128)
        .checked_mul(bps as u128)
        .ok_or(MarketError::MathOverflow)?
        / (BPS_DENOMINATOR as u128);
    u64::try_from(out).map_err(|_| MarketError::MathOverflow)
}

/// Pro-rata share of `pot` owed to `tokens` out of `supply`, rounded down.
pub fn pro_rata(pot: u64, tokens: u64, supply: u64) -> Result<u64, MarketError> {
    if supply == 0 {
        return Ok(0);
    }
    let out = (pot as u128)
        .checked_mul(tokens as u128)
        .ok_or(MarketError::MathOverflow)?
        / (supply as u128);
    u64::try_from(out).map_err(|_| MarketError::MathOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ~$250 stock, 8-decimal stock mint: first token ≈ $0.10.
    const BASE: u64 = 40_000;
    const SLOPE: u64 = 4;

    #[test]
    fn first_token_costs_base() {
        assert_eq!(buy_cost(0, 1, BASE, SLOPE).unwrap(), BASE);
    }

    #[test]
    fn cost_matches_explicit_sum() {
        let supply = 7u64;
        let amount = 5u64;
        let expected: u64 = (supply..supply + amount)
            .map(|i| BASE + SLOPE * i)
            .sum();
        assert_eq!(buy_cost(supply, amount, BASE, SLOPE).unwrap(), expected);
    }

    #[test]
    fn splitting_a_buy_costs_the_same() {
        let whole = buy_cost(0, 100, BASE, SLOPE).unwrap();
        let split =
            buy_cost(0, 40, BASE, SLOPE).unwrap() + buy_cost(40, 60, BASE, SLOPE).unwrap();
        assert_eq!(whole, split);
    }

    #[test]
    fn a_sell_undoes_a_buy_exactly() {
        // Buying up to 500 then selling straight back returns the same stock,
        // which is what keeps the curve solvent in both directions.
        let bought = buy_cost(300, 200, BASE, SLOPE).unwrap();
        let refunded = sell_refund(500, 200, BASE, SLOPE).unwrap();
        assert_eq!(bought, refunded);
    }

    #[test]
    fn price_rises_with_supply() {
        assert!(spot_price(1_000, BASE, SLOPE).unwrap() > spot_price(0, BASE, SLOPE).unwrap());
    }

    /// The invariant the whole design rests on: buying and immediately
    /// redeeming must always lose, at every supply level.
    #[test]
    fn marginal_always_exceeds_average() {
        for supply in [1u64, 10, 1_000, 100_000, 5_000_000] {
            let vault = cost_of_range(0, supply, BASE, SLOPE).unwrap();
            let average = vault / supply;
            let marginal = spot_price(supply, BASE, SLOPE).unwrap();
            assert!(
                marginal > average,
                "supply {supply}: marginal {marginal} <= average {average}",
            );
        }
    }

    /// A buyer profits exactly when they bought in the first half of final
    /// supply — the property the product is sold on.
    #[test]
    fn early_buyers_redeem_more_than_they_paid() {
        let final_supply = 10_000u64;
        let vault = cost_of_range(0, final_supply, BASE, SLOPE).unwrap();
        let per_token = vault / final_supply;

        let early = spot_price(1_000, BASE, SLOPE).unwrap();
        let late = spot_price(9_000, BASE, SLOPE).unwrap();

        assert!(per_token > early, "a buyer at 10% of supply should gain");
        assert!(per_token < late, "a buyer at 90% of supply should lose");
    }

    #[test]
    fn zero_amount_rejected() {
        assert_eq!(
            buy_cost(0, 0, BASE, SLOPE).unwrap_err(),
            MarketError::ZeroAmount
        );
    }

    #[test]
    fn overflow_is_caught_not_wrapped() {
        assert_eq!(
            buy_cost(u64::MAX / 2, u64::MAX / 2, u64::MAX, u64::MAX).unwrap_err(),
            MarketError::MathOverflow
        );
    }

    #[test]
    fn bps_and_pro_rata_round_down() {
        assert_eq!(apply_bps(10_000, 1_000).unwrap(), 1_000); // 10%
        assert_eq!(apply_bps(9, 1_000).unwrap(), 0);
        assert_eq!(pro_rata(100, 3, 7).unwrap(), 42);
        assert_eq!(pro_rata(100, 0, 0).unwrap(), 0);
    }

    #[test]
    fn pro_rata_never_overpays_the_pot() {
        let pot = 1_000_000u64;
        let supply = 333u64;
        let total: u64 = (0..supply).map(|_| pro_rata(pot, 1, supply).unwrap()).sum();
        assert!(total <= pot);
    }
}
