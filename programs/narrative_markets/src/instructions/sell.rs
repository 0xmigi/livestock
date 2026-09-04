//! `sell(tokens_in: u64, min_stock_out: u64)`
//!
//! Burns narrative tokens and walks the curve back down, returning stock.
//!
//! # Why there is a tax
//!
//! Redemption at expiry pays the vault's *average* price; selling into the
//! curve pays the *marginal* price, which is always higher on a rising curve.
//! Left alone, every rational holder exits before expiry and the product's
//! central promise — that you never have to time an exit — collapses.
//!
//! `sell_tax_bps` stays in the vault, so leaving early pays whoever stays. It
//! is the main tuning dial in the design.

use {
    crate::{
        curve::{apply_bps, sell_refund},
        error::MarketError,
        state::*,
        utils::*,
    },
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        sysvars::{clock::Clock, Sysvar},
        AccountView, ProgramResult,
    },
    pinocchio_token::instructions::{Burn, TransferChecked},
};

const NARRATIVE: usize = 1;

/// Accounts:
/// 0. `[signer]` seller
/// 1. `[writable]` narrative PDA
/// 2. `[writable]` narrative mint PDA
/// 3. `[writable]` seller's narrative token account
/// 4. `[writable]` seller's stock token account — receives the proceeds
/// 5. `[writable]` vault token account
/// 6. `[]` stock mint
/// 7. `[]` token program — classic SPL, for the narrative mint
/// 8. `[]` stock token program
pub fn sell(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let tokens_in = read_u64(data, 0)?;
    let min_stock_out = read_u64(data, 8)?;

    if tokens_in == 0 {
        return Err(MarketError::ZeroAmount.into());
    }

    let now = Clock::get()?.unix_timestamp;

    {
        let [seller, narrative, narrative_mint, seller_tokens, seller_stock, vault, stock_mint, token_program, stock_token_program, ..] =
            &*accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_signer(seller)?;
        require_writable(narrative)?;
        require_program_owned(narrative)?;
        require_token_program(token_program)?;

        let narrative_data = narrative.try_borrow()?;
        let state = Narrative::from_bytes(&narrative_data)?;

        require_address(narrative_mint, &state.narrative_mint)?;
        require_address(vault, &state.vault)?;
        require_address(stock_mint, &state.stock_mint)?;
        require_address(stock_token_program, &state.stock_token_program)?;

        if state.status()? != Status::Live {
            return Err(MarketError::NotLive.into());
        }
        if now >= state.expiry_ts() {
            return Err(MarketError::Expired.into());
        }
        if tokens_in > state.supply() {
            return Err(MarketError::InsufficientSupply.into());
        }

        // The seller must own the tokens being burned.
        token_balance_checked(
            seller_tokens,
            &TOKEN_PROGRAM,
            &state.narrative_mint,
            seller.address(),
        )?;
        token_balance_for_mint(
            seller_stock,
            &state.stock_token_program,
            &state.stock_mint,
        )?;

        let refund = sell_refund(
            state.supply(),
            tokens_in,
            state.base_price(),
            state.slope(),
        )?;
        // The tax is simply not paid out — it stays behind for the holders.
        let tax = apply_bps(refund, state.sell_tax_bps())?;
        let payout = refund.checked_sub(tax).ok_or(MarketError::MathOverflow)?;

        if payout < min_stock_out {
            return Err(MarketError::SlippageExceeded.into());
        }

        let bump = state.bump;
        let decimals = state.stock_decimals;
        let stock_key = state.stock_mint;
        let stock_program = state.stock_token_program;
        let creator = state.creator;
        let name_buf = state.name;
        let name_len = state.name_len as usize;

        drop(narrative_data);

        Burn::new(seller_tokens, narrative_mint, seller, tokens_in).invoke()?;

        if payout > 0 {
            let bump_seed = [bump];
            let seeds = [
                Seed::from(NARRATIVE_SEED),
                Seed::from(stock_key.as_ref()),
                Seed::from(creator.as_ref()),
                Seed::from(&name_buf[..name_len]),
                Seed::from(&bump_seed),
            ];
            TransferChecked::new(vault, stock_mint, seller_stock, narrative, payout, decimals)
                .invoke_signed_with_program(&[Signer::from(&seeds[..])], &stock_program)?;
        }
    }

    let narrative = &mut accounts[NARRATIVE];
    let mut narrative_data = narrative.try_borrow_mut()?;
    Narrative::from_bytes_mut(&mut narrative_data)?.debit_supply(tokens_in)?;

    Ok(())
}
