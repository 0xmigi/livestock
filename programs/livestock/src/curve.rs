//! The pump.fun bonding curve, denominated in **stock base units**.
//!
//! A constant-product curve over two *virtual* reserves, exactly as pump.fun
//! runs it, with the stock standing in for SOL:
//!
//! ```text
//! k = virtual_stock × virtual_tokens
//!
//! buy  n tokens:  cost   = n × virtual_stock / (virtual_tokens − n) + 1
//! sell n tokens:  refund = n × virtual_stock / (virtual_tokens + n)
//! spot price     = virtual_stock / virtual_tokens
//! ```
//!
//! Every narrative starts with pump.fun's token-side numbers, in whole tokens
//! since narrative mints have 0 decimals: 1,073,000,000 virtual tokens, of
//! which 793,100,000 are ever sold by the curve, out of a nominal total supply
//! of 1,000,000,000. The stock side is chosen at creation: the client sets it
//! to what 30 SOL is worth in the stock, which is pump.fun's initial virtual
//! SOL. Buys add the cost to the stock reserve and take the tokens out of the
//! token reserve; sells do the reverse. Rounding always favours the vault: a
//! buy rounds its cost up, a sell rounds its refund down, so `k` can only ever
//! grow.
//!
//! When the sellable reserve runs out the curve is sold out. pump.fun would
//! migrate the pool to an AMM at that point; a narrative has nowhere to go and
//! nothing to do but wait for its date, so buys stop and sells keep working
//! until then.
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
//! `marginal / average` anyone can mint and redeem risk-free, diluting every
//! holder to do it.

use crate::error::MarketError;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// pump.fun's `initial_virtual_token_reserves`, in whole tokens.
pub const INITIAL_VIRTUAL_TOKEN_RESERVES: u64 = 1_073_000_000;
/// pump.fun's `initial_real_token_reserves`: how many tokens the curve will
/// ever sell. Supply can never exceed this.
pub const INITIAL_REAL_TOKEN_RESERVES: u64 = 793_100_000;
/// pump.fun's `token_total_supply`. Nothing on chain mints the remainder; it
/// is the figure market cap is quoted against.
pub const TOKEN_TOTAL_SUPPLY: u64 = 1_000_000_000;
/// pump.fun's `initial_virtual_sol_reserves`, in SOL. The client converts this
/// into the stock at creation.
pub const INITIAL_VIRTUAL_SOL: u64 = 30;

/// Stock owed to buy `amount` tokens from a curve holding these reserves.
///
/// pump.fun's `sol_cost`: rounded up by one base unit.
pub fn buy_cost(virtual_stock: u64, virtual_tokens: u64, amount: u64) -> Result<u64, MarketError> {
    if amount == 0 {
        return Err(MarketError::ZeroAmount);
    }
    let remaining = virtual_tokens
        .checked_sub(amount)
        .filter(|r| *r > 0)
        .ok_or(MarketError::MathOverflow)?;
    let cost = (amount as u128)
        .checked_mul(virtual_stock as u128)
        .ok_or(MarketError::MathOverflow)?
        / (remaining as u128);
    let cost = cost.checked_add(1).ok_or(MarketError::MathOverflow)?;
    u64::try_from(cost).map_err(|_| MarketError::MathOverflow)
}

/// Stock returned for selling `amount` tokens back into a curve holding these
/// reserves. Rounded down.
pub fn sell_refund(
    virtual_stock: u64,
    virtual_tokens: u64,
    amount: u64,
) -> Result<u64, MarketError> {
    if amount == 0 {
        return Err(MarketError::ZeroAmount);
    }
    let after = (virtual_tokens as u128)
        .checked_add(amount as u128)
        .ok_or(MarketError::MathOverflow)?;
    let refund = (amount as u128)
        .checked_mul(virtual_stock as u128)
        .ok_or(MarketError::MathOverflow)?
        / after;
    u64::try_from(refund).map_err(|_| MarketError::MathOverflow)
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

    // 30 SOL at $150 is $4,500, which in a $250 stock with 8 decimals is
    // 18 shares.
    const VSTOCK: u64 = 1_800_000_000;
    const VTOKENS: u64 = INITIAL_VIRTUAL_TOKEN_RESERVES;

    /// A curve walked forward the way the instructions walk it.
    struct Curve {
        stock: u64,
        tokens: u64,
        supply: u64,
        vault: u64,
    }

    impl Curve {
        fn new() -> Self {
            Self { stock: VSTOCK, tokens: VTOKENS, supply: 0, vault: 0 }
        }
        fn buy(&mut self, n: u64) -> u64 {
            let cost = buy_cost(self.stock, self.tokens, n).unwrap();
            self.stock += cost;
            self.tokens -= n;
            self.supply += n;
            self.vault += cost;
            cost
        }
        fn sell(&mut self, n: u64) -> u64 {
            let refund = sell_refund(self.stock, self.tokens, n).unwrap();
            self.stock -= refund;
            self.tokens += n;
            self.supply -= n;
            self.vault -= refund;
            refund
        }
        fn k(&self) -> u128 {
            self.stock as u128 * self.tokens as u128
        }
    }

    #[test]
    fn matches_pump_fun_arithmetic() {
        // pump.fun's own numbers, in lamports and 6-decimal tokens: buying
        // the whole real reserve from a fresh curve costs a touch over 85 SOL.
        let cost = buy_cost(30_000_000_000, 1_073_000_000_000_000, 793_100_000_000_000).unwrap();
        assert_eq!(cost, 85_005_359_057);
        // And one token from a fresh curve is 27.96 lamports, rounded up.
        assert_eq!(buy_cost(30_000_000_000, 1_073_000_000_000_000, 1_000_000).unwrap(), 28);
    }

    #[test]
    fn splitting_a_buy_costs_at_least_as_much() {
        let mut whole = Curve::new();
        let one = whole.buy(1_000_000);
        let mut split = Curve::new();
        let two = split.buy(400_000) + split.buy(600_000);
        assert!(two >= one);
        assert!(two - one <= 1, "only the extra round-up separates them");
    }

    #[test]
    fn a_sell_never_returns_more_than_the_buy() {
        let mut c = Curve::new();
        c.buy(50_000_000);
        let paid = c.buy(10_000_000);
        let refunded = c.sell(10_000_000);
        assert!(refunded <= paid);
        assert!(paid - refunded <= 2);
    }

    #[test]
    fn k_only_grows() {
        let mut c = Curve::new();
        let mut k = c.k();
        for n in [1, 7, 1_000, 3_333_333, 50_000_000, 2, 999_999] {
            c.buy(n);
            assert!(c.k() >= k);
            k = c.k();
            c.sell(n / 2 + 1);
            assert!(c.k() >= k);
            k = c.k();
        }
    }

    #[test]
    fn price_rises_with_supply() {
        let mut c = Curve::new();
        let first = c.buy(1_000_000);
        c.buy(200_000_000);
        let later = c.buy(1_000_000);
        assert!(later > first);
    }

    /// The invariant the whole design rests on: buying and immediately
    /// redeeming can never profit, at any supply level.
    ///
    /// Near zero supply the curve is so flat that marginal and average agree
    /// to within a base unit, so the buyer gets exactly their stock back —
    /// and loses the fee. The only way to come out a base unit ahead is to
    /// collect other people's round-ups, which are capped at one unit per
    /// earlier trade: dust, and less than a transaction fee.
    #[test]
    fn marginal_never_falls_below_average() {
        for supply in [1u64, 1_000, 1_000_000, 100_000_000, 500_000_000, 793_000_000] {
            let mut c = Curve::new();
            c.buy(supply);
            let n = 100_000.min(INITIAL_REAL_TOKEN_RESERVES - supply).max(1);
            let paid = c.buy(n);
            let redeemed = pro_rata(c.vault, n, c.supply).unwrap();
            assert!(
                redeemed <= paid,
                "supply {supply}: paid {paid}, would redeem {redeemed}",
            );
            let fee = apply_bps(paid, 100).unwrap();
            assert!(redeemed < paid + fee, "with the fee it is always a loss");
        }
        // Once there is real supply the gap is real.
        let mut c = Curve::new();
        c.buy(100_000_000);
        let paid = c.buy(1_000_000);
        assert!(pro_rata(c.vault, 1_000_000, c.supply).unwrap() < paid);
    }

    /// The product's claim: buy early into a narrative that keeps growing and
    /// you redeem more stock than you paid.
    #[test]
    fn early_buyers_redeem_more_than_they_paid() {
        let mut c = Curve::new();
        let paid = c.buy(10_000_000);
        c.buy(400_000_000);
        let redeemed = pro_rata(c.vault, 10_000_000, c.supply).unwrap();
        assert!(redeemed > paid, "paid {paid}, redeem {redeemed}");
    }

    #[test]
    fn selling_the_whole_curve_leaves_dust_only() {
        let mut c = Curve::new();
        c.buy(INITIAL_REAL_TOKEN_RESERVES);
        c.sell(INITIAL_REAL_TOKEN_RESERVES);
        assert_eq!(c.supply, 0);
        assert!(c.vault <= 2, "rounding left {} behind", c.vault);
        assert!(c.stock >= VSTOCK);
    }

    #[test]
    fn zero_amount_rejected() {
        assert_eq!(buy_cost(VSTOCK, VTOKENS, 0).unwrap_err(), MarketError::ZeroAmount);
        assert_eq!(sell_refund(VSTOCK, VTOKENS, 0).unwrap_err(), MarketError::ZeroAmount);
    }

    #[test]
    fn buying_the_virtual_reserve_is_impossible() {
        assert_eq!(buy_cost(VSTOCK, VTOKENS, VTOKENS).unwrap_err(), MarketError::MathOverflow);
        assert_eq!(buy_cost(VSTOCK, VTOKENS, VTOKENS + 1).unwrap_err(), MarketError::MathOverflow);
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
