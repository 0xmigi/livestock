use crate::errors::SeasonVaultError;
use anchor_lang::prelude::*;

/// Cost in lamports to buy `amount` raw tokens starting from `supply`,
/// using price_per_whole_token = base + slope * whole_tokens.
///
/// Discrete integral of a linear curve, scaled by 10^decimals.
pub fn token_cost(
    base: u64,
    slope: u64,
    supply: u64,
    amount: u64,
    decimals: u8,
) -> Result<u64> {
    if amount == 0 {
        return Ok(0);
    }
    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    let amount = amount as u128;
    let supply = supply as u128;
    let base = base as u128;
    let slope = slope as u128;

    // term1 = amount * base / scale
    let term1 = amount
        .checked_mul(base)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        / scale;

    // term2 = slope * amount * (2*supply + amount - 1) / (2 * scale^2)
    let span = supply
        .checked_mul(2)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        .checked_add(amount)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        .checked_sub(1)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    let numer = slope
        .checked_mul(amount)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        .checked_mul(span)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    let denom = scale
        .checked_mul(scale)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        .checked_mul(2)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    let term2 = numer / denom;

    let cost = term1
        .checked_add(term2)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    u64::try_from(cost).map_err(|_| SeasonVaultError::ArithmeticOverflow.into())
}

/// Largest raw token amount whose integral cost is <= sol_in.
pub fn tokens_out_for_sol(
    base: u64,
    slope: u64,
    supply: u64,
    sol_in: u64,
    decimals: u8,
) -> Result<u64> {
    if sol_in == 0 {
        return Ok(0);
    }
    let scale = 10u64
        .checked_pow(decimals as u32)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    // Upper bound: even at price 0, one lamport can't buy more than sol_in * scale
    // if we required >= 1 lamport per whole token — still cap search.
    let mut hi = sol_in.saturating_mul(scale);
    if hi == 0 {
        hi = sol_in;
    }
    // If even 1 token is too expensive, return 0.
    if let Ok(c) = token_cost(base, slope, supply, 1, decimals) {
        if c > sol_in {
            return Ok(0);
        }
    }
    let mut lo = 0u64;
    while lo < hi {
        let mid = lo.saturating_add(hi.saturating_sub(lo).saturating_add(1) / 2);
        match token_cost(base, slope, supply, mid, decimals) {
            Ok(cost) if cost <= sol_in => lo = mid,
            _ => {
                if mid == 0 {
                    return Ok(0);
                }
                hi = mid.saturating_sub(1);
            }
        }
    }
    Ok(lo)
}

/// Pro-rata stock. Last remaining holder receives leftover dust.
pub fn pro_rata_stock(remaining_stock: u64, remaining_supply: u64, user_tokens: u64) -> Result<u64> {
    if user_tokens == 0 || remaining_supply == 0 {
        return Err(SeasonVaultError::NothingToRedeem.into());
    }
    if user_tokens == remaining_supply {
        return Ok(remaining_stock);
    }
    let out = (remaining_stock as u128)
        .checked_mul(user_tokens as u128)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        / remaining_supply as u128;
    u64::try_from(out).map_err(|_| SeasonVaultError::ArithmeticOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_token_costs_base_zero_decimals() {
        assert_eq!(token_cost(10_000_000, 100, 0, 1, 0).unwrap(), 10_000_000);
    }

    #[test]
    fn two_tokens_include_slope() {
        // costs: 10_000_000 + (10_000_000 + 100) = 20_000_100
        assert_eq!(token_cost(10_000_000, 100, 0, 2, 0).unwrap(), 20_000_100);
    }

    #[test]
    fn invert_cost() {
        let sol = token_cost(10_000_000, 100, 0, 5, 0).unwrap();
        assert_eq!(tokens_out_for_sol(10_000_000, 100, 0, sol, 0).unwrap(), 5);
        assert_eq!(
            tokens_out_for_sol(10_000_000, 100, 0, sol - 1, 0).unwrap(),
            4
        );
    }

    #[test]
    fn last_redeemer_gets_dust() {
        assert_eq!(pro_rata_stock(10, 3, 1).unwrap(), 3);
        assert_eq!(pro_rata_stock(7, 2, 2).unwrap(), 7);
    }
}
