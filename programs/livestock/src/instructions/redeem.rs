//! `redeem()`
//!
//! Burns the caller's entire narrative balance for a pro-rata share of the
//! frozen vault. Redeeming everything at once is deliberate: it makes a second
//! redeem impossible on token balance alone, so no per-holder account is
//! needed to track who has claimed.
//!
//! Claims never expire. There is no deadline and no sweep of unclaimed stock.

use {
    crate::{curve::pro_rata, error::MarketError, state::*, utils::*},
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        AccountView, ProgramResult,
    },
    pinocchio_token::instructions::{Burn, TransferChecked},
};

const NARRATIVE: usize = 1;

/// Accounts:
/// 0. `[signer]` holder
/// 1. `[writable]` narrative PDA
/// 2. `[writable]` narrative mint
/// 3. `[writable]` holder's narrative token account
/// 4. `[writable]` holder's stock token account — receives the payout
/// 5. `[writable]` vault token account
/// 6. `[]` stock mint
/// 7. `[]` narrative token program — Token-2022
/// 8. `[]` stock token program
pub fn redeem(accounts: &mut [AccountView]) -> ProgramResult {
    let (tokens, payout) = {
        let [holder, narrative, narrative_mint, holder_tokens, holder_stock, vault, stock_mint, token_program, stock_token_program, ..] =
            &*accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_signer(holder)?;
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

        // The holder must own every token being burned.
        let tokens =
            token_balance_checked(
                holder_tokens,
                &NARRATIVE_TOKEN_PROGRAM,
                &state.narrative_mint,
                holder.address(),
            )?;
        if tokens == 0 {
            return Err(MarketError::NothingToRedeem.into());
        }
        token_balance_for_mint(
            holder_stock,
            &state.stock_token_program,
            &state.stock_mint,
        )?;

        let remaining = state.supply();
        let vault_balance =
            token_balance_checked(
                vault,
                &state.stock_token_program,
                &state.stock_mint,
                narrative.address(),
            )?;

        // Integer division rounds every claim down, so the final claimant takes
        // whatever is left rather than leaving dust stranded in the vault.
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

        Burn::new(holder_tokens, narrative_mint, holder, tokens)
            .invoke_with_program(&NARRATIVE_TOKEN_PROGRAM)?;

        if payout > 0 {
            let bump_seed = [bump];
            let seeds = [
                Seed::from(NARRATIVE_SEED),
                Seed::from(mint_key.as_ref()),
                Seed::from(&bump_seed),
            ];
            TransferChecked::new(vault, stock_mint, holder_stock, narrative, payout, decimals)
                .invoke_signed_with_program(&[Signer::from(&seeds[..])], &stock_program)?;
        }

        (tokens, payout)
    };
    let _ = payout;

    let narrative = &mut accounts[NARRATIVE];
    let mut narrative_data = narrative.try_borrow_mut()?;
    let state = Narrative::from_bytes_mut(&mut narrative_data)?;

    state.debit_supply(tokens)?;
    if state.supply() == 0 {
        state.set_status(Status::Settled);
    }

    Ok(())
}
