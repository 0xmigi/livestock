//! `convert()`
//!
//! Pays one holder out after expiry **without their signature**: burns their
//! whole narrative balance through the mint's permanent delegate — which
//! `create_narrative` requires to be the narrative itself — and sends their
//! pro-rata share of the frozen vault to a stock account they own.
//!
//! Permissionless, so a keeper can walk every holder the moment a narrative
//! expires; `redeem` remains for a holder who would rather claim themselves.
//! The stock account must belong to the token account's owner, so a caller
//! can trigger a payout but never redirect one.

use {
    crate::{curve::pro_rata, error::MarketError, state::*, utils::*},
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        AccountView, ProgramResult,
    },
    pinocchio_token::instructions::{Burn, TransferChecked},
};

const NARRATIVE: usize = 0;

/// Accounts:
/// 0. `[writable]` narrative PDA
/// 1. `[writable]` narrative mint
/// 2. `[writable]` holder's narrative token account
/// 3. `[writable]` holder's stock token account — receives the payout; must
///    be owned by the same wallet as account 2
/// 4. `[writable]` vault token account
/// 5. `[]` stock mint
/// 6. `[]` narrative token program — Token-2022
/// 7. `[]` stock token program
pub fn convert(accounts: &mut [AccountView]) -> ProgramResult {
    let tokens = {
        let [narrative, narrative_mint, holder_tokens, holder_stock, vault, stock_mint, token_program, stock_token_program, ..] =
            &*accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_writable(narrative)?;
        require_program_owned(narrative)?;
        require_narrative_token_program(token_program)?;

        let narrative_data = narrative.try_borrow()?;
        let state = Narrative::from_bytes(&narrative_data)?;

        require_address(narrative_mint, &state.narrative_mint)?;
        require_address(vault, &state.vault)?;
        require_address(stock_mint, &state.stock_mint)?;
        require_address(stock_token_program, &state.stock_token_program)?;

        if state.status()? != Status::Expired {
            return Err(MarketError::NotExpired.into());
        }

        let (holder, tokens) = token_owner_and_balance(
            holder_tokens,
            &NARRATIVE_TOKEN_PROGRAM,
            &state.narrative_mint,
        )?;
        if tokens == 0 {
            return Err(MarketError::NothingToRedeem.into());
        }
        // The payout goes to the holder and nobody else.
        token_balance_checked(
            holder_stock,
            &state.stock_token_program,
            &state.stock_mint,
            &holder,
        )?;

        let remaining = state.supply();
        let vault_balance = token_balance_checked(
            vault,
            &state.stock_token_program,
            &state.stock_mint,
            narrative.address(),
        )?;

        // Same arithmetic as `redeem`: rounded down, last claimant sweeps.
        let payout = if tokens >= remaining {
            vault_balance
        } else {
            pro_rata(state.final_vault(), tokens, state.final_supply())?.min(vault_balance)
        };

        let bump = state.bump;
        let decimals = state.stock_decimals;
        let mint_key = state.narrative_mint;
        let stock_program = state.stock_token_program;

        drop(narrative_data);

        let bump_seed = [bump];
        let seeds = [
            Seed::from(NARRATIVE_SEED),
            Seed::from(mint_key.as_ref()),
            Seed::from(&bump_seed),
        ];

        // The narrative burns as permanent delegate, signing as itself.
        Burn::new(holder_tokens, narrative_mint, narrative, tokens)
            .invoke_signed_with_program(&[Signer::from(&seeds[..])], &NARRATIVE_TOKEN_PROGRAM)?;

        if payout > 0 {
            TransferChecked::new(vault, stock_mint, holder_stock, narrative, payout, decimals)
                .invoke_signed_with_program(&[Signer::from(&seeds[..])], &stock_program)?;
        }

        tokens
    };

    let narrative = &mut accounts[NARRATIVE];
    let mut narrative_data = narrative.try_borrow_mut()?;
    let state = Narrative::from_bytes_mut(&mut narrative_data)?;

    state.debit_supply(tokens)?;
    if state.supply() == 0 {
        state.set_status(Status::Settled);
    }

    Ok(())
}
