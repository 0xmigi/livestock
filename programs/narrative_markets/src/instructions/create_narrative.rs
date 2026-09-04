//! `create_narrative(expiry_ts, base_price, slope, fee_bps, sell_tax_bps, name, symbol)`
//!
//! Permissionless. Anyone can launch a narrative against any stock mint.
//!
//! The expiry passed here is written once and never becomes writable again —
//! no instruction in this program can move it, including for the creator.

use {
    crate::{
        error::MarketError,
        state::*,
        utils::*,
    },
    pinocchio::{
        cpi::Seed,
        error::ProgramError,
        sysvars::{clock::Clock, Sysvar},
        AccountView, ProgramResult,
    },
    pinocchio_token::{
        instructions::{InitializeAccount3, InitializeMint2},
        state::{Account as TokenAccount, Mint},
    },
};

const NARRATIVE: usize = 1;

/// Accounts:
/// 0. `[signer, writable]` creator — also the rent payer
/// 1. `[writable]` narrative PDA
/// 2. `[]` stock mint
/// 3. `[writable]` narrative mint PDA
/// 4. `[writable]` vault token account PDA
/// 5. `[]` system program
/// 6. `[]` token program
pub fn create_narrative(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    // --- decode ----------------------------------------------------------
    let expiry_ts = read_i64(data, 0)?;
    let base_price = read_u64(data, 8)?;
    let slope = read_u64(data, 16)?;
    let fee_bps = read_u16(data, 24)?;
    let sell_tax_bps = read_u16(data, 26)?;
    let name_len = read_u8(data, 28)? as usize;

    let name_start: usize = 29;
    let name_end = name_start
        .checked_add(name_len)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let name = data
        .get(name_start..name_end)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let symbol = data
        .get(name_end..)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if name.is_empty()
        || name.len() > MAX_NAME_LEN
        || symbol.is_empty()
        || symbol.len() > MAX_SYMBOL_LEN
    {
        return Err(MarketError::InvalidInstructionData.into());
    }
    if base_price == 0 || slope == 0 {
        return Err(MarketError::BadParameters.into());
    }
    if fee_bps > MAX_FEE_BPS || sell_tax_bps > MAX_SELL_TAX_BPS {
        return Err(MarketError::BadParameters.into());
    }

    let now = Clock::get()?.unix_timestamp;
    let duration = expiry_ts
        .checked_sub(now)
        .ok_or(MarketError::MathOverflow)?;
    if !(MIN_DURATION_SECS..=MAX_DURATION_SECS).contains(&duration) {
        return Err(MarketError::BadExpiry.into());
    }

    // --- validate and create accounts ------------------------------------
    let (creator_key, stock_key, narrative_key, mint_key, vault_key, bump, mint_bump, vault_bump) = {
        let [creator, narrative, stock_mint, narrative_mint, vault, system_program, token_program, ..] =
            &*accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_signer(creator)?;
        require_writable(narrative)?;
        require_system_program(system_program)?;
        require_token_program(token_program)?;

        // Confirm the stock is a real, initialized SPL mint before building a
        // narrative around it.
        if !mint_is_initialized(stock_mint)? {
            return Err(MarketError::InvalidTokenAccount.into());
        }

        let creator_key = *creator.address();
        let stock_key = *stock_mint.address();

        // Seeding on (stock, creator, name) means one creator gets one
        // narrative per name per stock, while anyone else may reuse the name.
        let (narrative_key, bump) =
            derive_pda(&[NARRATIVE_SEED, stock_key.as_ref(), creator_key.as_ref(), name]);
        require_address(narrative, &narrative_key)?;

        let (mint_key, mint_bump) = derive_pda(&[MINT_SEED, narrative_key.as_ref()]);
        require_address(narrative_mint, &mint_key)?;

        let (vault_key, vault_bump) = derive_pda(&[VAULT_SEED, narrative_key.as_ref()]);
        require_address(vault, &vault_key)?;

        // --- narrative account -------------------------------------------
        let bump_seed = [bump];
        create_pda_account(
            creator,
            narrative,
            NARRATIVE_LEN,
            &crate::ID,
            &[
                Seed::from(NARRATIVE_SEED),
                Seed::from(stock_key.as_ref()),
                Seed::from(creator_key.as_ref()),
                Seed::from(name),
                Seed::from(&bump_seed),
            ],
        )?;

        // --- narrative mint, authority = the narrative PDA ----------------
        let mint_bump_seed = [mint_bump];
        create_pda_account(
            creator,
            narrative_mint,
            Mint::LEN,
            &pinocchio_token::ID,
            &[
                Seed::from(MINT_SEED),
                Seed::from(narrative_key.as_ref()),
                Seed::from(&mint_bump_seed),
            ],
        )?;
        InitializeMint2::new(
            narrative_mint,
            NARRATIVE_DECIMALS,
            &narrative_key,
            // No freeze authority. Expiry revokes the mint authority instead,
            // which is what actually stops supply growing.
            None,
        )
        .invoke()?;

        // --- vault, owned by the narrative PDA ----------------------------
        let vault_bump_seed = [vault_bump];
        create_pda_account(
            creator,
            vault,
            TokenAccount::LEN,
            &pinocchio_token::ID,
            &[
                Seed::from(VAULT_SEED),
                Seed::from(narrative_key.as_ref()),
                Seed::from(&vault_bump_seed),
            ],
        )?;
        InitializeAccount3::new(vault, stock_mint, &narrative_key).invoke()?;

        (
            creator_key,
            stock_key,
            narrative_key,
            mint_key,
            vault_key,
            bump,
            mint_bump,
            vault_bump,
        )
    };
    let _ = narrative_key;

    // --- write state -----------------------------------------------------
    let narrative = &mut accounts[NARRATIVE];
    let mut narrative_data = narrative.try_borrow_mut()?;
    Narrative::initialize(&mut narrative_data)?.init(
        &creator_key,
        &stock_key,
        &mint_key,
        &vault_key,
        name,
        symbol,
        now,
        expiry_ts,
        base_price,
        slope,
        fee_bps,
        sell_tax_bps,
        bump,
        mint_bump,
        vault_bump,
    )?;

    Ok(())
}
