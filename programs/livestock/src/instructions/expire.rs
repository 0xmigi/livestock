//! `expire()`
//!
//! Permissionless once `expiry_ts` has passed, and callable by **nobody**
//! before then — the creator has no privilege here. That is what makes the
//! expiry date a real commitment rather than a setting.
//!
//! Takes the protocol's conversion fee out of the vault, then freezes the two
//! numbers redemption divides against and revokes the mint authority, which
//! is a stronger guarantee than freezing and is irreversible.

use {
    crate::{
        curve::apply_bps,
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
    pinocchio_token::instructions::{AuthorityType, SetAuthority, TransferChecked},
};

const NARRATIVE: usize = 0;

/// Accounts:
/// 0. `[writable]` narrative PDA
/// 1. `[writable]` narrative mint
/// 2. `[writable]` vault token account
/// 3. `[]` stock mint
/// 4. `[writable]` treasury's stock token account — receives the conversion fee
/// 5. `[]` narrative token program — Token-2022
/// 6. `[]` stock token program
pub fn expire(accounts: &mut [AccountView]) -> ProgramResult {
    let now = Clock::get()?.unix_timestamp;

    let vault_balance = {
        let [narrative, narrative_mint, vault, stock_mint, treasury_fee, token_program, stock_token_program, ..] =
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

        if state.status()? != Status::Live {
            return Err(MarketError::NotLive.into());
        }
        // No early exit, for anyone.
        if now < state.expiry_ts() {
            return Err(MarketError::TooEarly.into());
        }

        let vault_balance =
            token_balance_checked(
                vault,
                &state.stock_token_program,
                &state.stock_mint,
                narrative.address(),
            )?;

        // The protocol's cut of what the narrative gathered, taken once here
        // so every holder's share is computed from what is left.
        let conversion_fee = apply_bps(vault_balance, state.conversion_fee_bps())?;
        if conversion_fee > 0 {
            token_balance_checked(
                treasury_fee,
                &state.stock_token_program,
                &state.stock_mint,
                &TREASURY,
            )?;
        }

        let bump = state.bump;
        let mint_key = state.narrative_mint;
        let decimals = state.stock_decimals;
        let stock_program = state.stock_token_program;

        drop(narrative_data);

        let bump_seed = [bump];
        let seeds = [
            Seed::from(NARRATIVE_SEED),
            Seed::from(mint_key.as_ref()),
            Seed::from(&bump_seed),
        ];
        if conversion_fee > 0 {
            TransferChecked::new(vault, stock_mint, treasury_fee, narrative, conversion_fee, decimals)
                .invoke_signed_with_program(&[Signer::from(&seeds[..])], &stock_program)?;
        }
        SetAuthority::new(narrative_mint, narrative, AuthorityType::MintTokens, None)
            .invoke_signed_with_program(
                &[Signer::from(&seeds[..])],
                &NARRATIVE_TOKEN_PROGRAM,
            )?;

        vault_balance - conversion_fee
    };

    let narrative = &mut accounts[NARRATIVE];
    let mut narrative_data = narrative.try_borrow_mut()?;
    let state = Narrative::from_bytes_mut(&mut narrative_data)?;

    state.freeze(vault_balance);
    // A narrative nobody bought settles immediately — there is nothing to claim.
    state.set_status(if state.final_supply() == 0 {
        Status::Settled
    } else {
        Status::Expired
    });

    Ok(())
}
