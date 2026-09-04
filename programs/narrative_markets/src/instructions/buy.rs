//! `buy(tokens_out: u64, max_stock_in: u64)`
//!
//! Takes stock in, mints narrative tokens out. The caller pays dollars — the
//! client composes a Jupiter swap ahead of this instruction in the same
//! transaction, so by the time the program runs, the buyer holds stock.
//!
//! The program never touches USDC. That keeps it self-contained and testable,
//! and keeps the curve denominated in the stock, which is what closes the
//! mint-and-redeem arbitrage described in [`crate::curve`].

use {
    crate::{
        curve::{apply_bps, buy_cost},
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
    pinocchio_token::instructions::{MintTo, Transfer},
};

const NARRATIVE: usize = 1;

/// Accounts:
/// 0. `[signer]` buyer
/// 1. `[writable]` narrative PDA
/// 2. `[writable]` narrative mint PDA
/// 3. `[writable]` buyer's narrative token account
/// 4. `[writable]` buyer's stock token account — the source of payment
/// 5. `[writable]` vault token account
/// 6. `[writable]` creator's stock token account — receives the fee
/// 7. `[]` token program
pub fn buy(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let tokens_out = read_u64(data, 0)?;
    let max_stock_in = read_u64(data, 8)?;

    if tokens_out == 0 {
        return Err(MarketError::ZeroAmount.into());
    }

    let now = Clock::get()?.unix_timestamp;

    {
        let [buyer, narrative, narrative_mint, buyer_tokens, buyer_stock, vault, creator_fee, token_program, ..] =
            &*accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_signer(buyer)?;
        require_writable(narrative)?;
        require_program_owned(narrative)?;
        require_token_program(token_program)?;

        let narrative_data = narrative.try_borrow()?;
        let state = Narrative::from_bytes(&narrative_data)?;

        // --- wiring ------------------------------------------------------
        require_address(narrative_mint, &state.narrative_mint)?;
        require_address(vault, &state.vault)?;
        verify_pda(
            narrative,
            &[
                NARRATIVE_SEED,
                state.stock_mint.as_ref(),
                state.creator.as_ref(),
                state.name(),
            ],
            state.bump,
        )?;

        // --- status and clock, re-checked every transaction ---------------
        if state.status()? != Status::Live {
            return Err(MarketError::NotLive.into());
        }
        if now >= state.expiry_ts() {
            return Err(MarketError::Expired.into());
        }

        // --- pricing ------------------------------------------------------
        let cost = buy_cost(
            state.supply(),
            tokens_out,
            state.base_price(),
            state.slope(),
        )?;
        let fee = apply_bps(cost, state.fee_bps())?;
        let total = cost.checked_add(fee).ok_or(MarketError::MathOverflow)?;

        if total > max_stock_in {
            return Err(MarketError::SlippageExceeded.into());
        }

        // The buyer's token account must be for this narrative's mint. Its
        // owner is unconstrained — buying into another wallet is harmless.
        token_balance_for_mint(buyer_tokens, &state.narrative_mint)?;
        // Payment must come from an account the buyer actually owns.
        token_balance_checked(buyer_stock, &state.stock_mint, buyer.address())?;
        if fee > 0 {
            token_balance_for_mint(creator_fee, &state.stock_mint)?;
        }

        let bump = state.bump;
        let stock_mint = state.stock_mint;
        let creator = state.creator;
        let name_buf = state.name;
        let name_len = state.name_len as usize;

        drop(narrative_data);

        // --- stock in ------------------------------------------------------
        Transfer::new(buyer_stock, vault, buyer, cost).invoke()?;
        if fee > 0 {
            Transfer::new(buyer_stock, creator_fee, buyer, fee).invoke()?;
        }

        // --- narrative tokens out, signed by the narrative PDA -------------
        let bump_seed = [bump];
        let seeds = [
            Seed::from(NARRATIVE_SEED),
            Seed::from(stock_mint.as_ref()),
            Seed::from(creator.as_ref()),
            Seed::from(&name_buf[..name_len]),
            Seed::from(&bump_seed),
        ];
        MintTo::new(narrative_mint, buyer_tokens, narrative, tokens_out)
            .invoke_signed(&[Signer::from(&seeds[..])])?;
    }

    let narrative = &mut accounts[NARRATIVE];
    let mut narrative_data = narrative.try_borrow_mut()?;
    Narrative::from_bytes_mut(&mut narrative_data)?.credit_supply(tokens_out)?;

    Ok(())
}
