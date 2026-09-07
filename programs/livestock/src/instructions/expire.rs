//! `expire()`
//!
//! Permissionless once `expiry_ts` has passed, and callable by **nobody**
//! before then — the creator has no privilege here. That is what makes the
//! expiry date a real commitment rather than a setting.
//!
//! Freezes the two numbers redemption divides against and revokes the mint
//! authority, which is a stronger guarantee than freezing and is irreversible.

use {
    crate::{error::MarketError, state::*, utils::*},
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        sysvars::{clock::Clock, Sysvar},
        AccountView, ProgramResult,
    },
    pinocchio_token::instructions::{AuthorityType, SetAuthority},
};

const NARRATIVE: usize = 0;

/// Accounts:
/// 0. `[writable]` narrative PDA
/// 1. `[writable]` narrative mint
/// 2. `[]` vault token account
/// 3. `[]` narrative token program — Token-2022
pub fn expire(accounts: &mut [AccountView]) -> ProgramResult {
    let now = Clock::get()?.unix_timestamp;

    let vault_balance = {
        let [narrative, narrative_mint, vault, token_program, ..] = &*accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_writable(narrative)?;
        require_program_owned(narrative)?;
        require_narrative_token_program(token_program)?;

        let narrative_data = narrative.try_borrow()?;
        let state = Narrative::from_bytes(&narrative_data)?;

        require_address(narrative_mint, &state.narrative_mint)?;
        require_address(vault, &state.vault)?;

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

        let bump = state.bump;
        let mint_key = state.narrative_mint;

        drop(narrative_data);

        let bump_seed = [bump];
        let seeds = [
            Seed::from(NARRATIVE_SEED),
            Seed::from(mint_key.as_ref()),
            Seed::from(&bump_seed),
        ];
        SetAuthority::new(narrative_mint, narrative, AuthorityType::MintTokens, None)
            .invoke_signed_with_program(
                &[Signer::from(&seeds[..])],
                &NARRATIVE_TOKEN_PROGRAM,
            )?;

        vault_balance
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
