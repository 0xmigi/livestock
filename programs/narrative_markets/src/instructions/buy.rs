//! `buy(tokens_out: u64, max_stock_in: u64)`
//!
//! Takes stock in, mints narrative tokens out. The caller pays dollars — the
//! client swaps USDC into the stock ahead of this instruction in the same
//! transaction, so by the time the program runs, the buyer holds stock.
//!
//! The program never touches USDC. That keeps it self-contained and testable,
//! and keeps the curve denominated in the stock, which is what closes the
//! mint-and-redeem arbitrage described in [`crate::curve`].
//!
//! Stock moves with `TransferChecked` against whichever token program the
//! stock belongs to — tokenized stocks are Token-2022, not classic SPL.

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
    pinocchio_token::instructions::{MintTo, TransferChecked},
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
/// 7. `[]` stock mint
/// 8. `[]` token program — classic SPL, for the narrative mint
/// 9. `[]` stock token program
pub fn buy(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let tokens_out = read_u64(data, 0)?;
    let max_stock_in = read_u64(data, 8)?;

    if tokens_out == 0 {
        return Err(MarketError::ZeroAmount.into());
    }

    let now = Clock::get()?.unix_timestamp;

    {
        let [buyer, narrative, narrative_mint, buyer_tokens, buyer_stock, vault, creator_fee, stock_mint, token_program, stock_token_program, ..] =
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
        require_address(stock_mint, &state.stock_mint)?;
        require_address(stock_token_program, &state.stock_token_program)?;
        verify_pda(narrative, &state.signer_seeds(), state.bump)?;

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
        token_balance_for_mint(buyer_tokens, &TOKEN_PROGRAM, &state.narrative_mint)?;
        // Payment must come from an account the buyer actually owns.
        token_balance_checked(
            buyer_stock,
            &state.stock_token_program,
            &state.stock_mint,
            buyer.address(),
        )?;
        if fee > 0 {
            token_balance_for_mint(
                creator_fee,
                &state.stock_token_program,
                &state.stock_mint,
            )?;
        }

        let bump = state.bump;
        let decimals = state.stock_decimals;
        let stock_key = state.stock_mint;
        let creator = state.creator;
        let name_buf = state.name;
        let name_len = state.name_len as usize;
        let stock_program = state.stock_token_program;

        drop(narrative_data);

        // --- stock in ------------------------------------------------------
        TransferChecked::new(buyer_stock, stock_mint, vault, buyer, cost, decimals)
            .invoke_with_program(&stock_program)?;
        if fee > 0 {
            TransferChecked::new(buyer_stock, stock_mint, creator_fee, buyer, fee, decimals)
                .invoke_with_program(&stock_program)?;
        }

        // --- narrative tokens out, signed by the narrative PDA -------------
        let bump_seed = [bump];
        let seeds = [
            Seed::from(NARRATIVE_SEED),
            Seed::from(stock_key.as_ref()),
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
