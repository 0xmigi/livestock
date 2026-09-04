//! `create_narrative(expiry_ts, base_price, slope, fee_bps, sell_tax_bps, name, symbol)`
//!
//! Permissionless. Anyone can launch a narrative against any stock mint.
//!
//! The expiry written here never becomes writable again — no instruction in
//! this program can move it, the creator included.
//!
//! The **vault is supplied, not created**. It must be a token account for the
//! stock mint owned by this narrative's PDA; the client creates it as an
//! associated token account in the same transaction. That is deliberate:
//! tokenized stocks are Token-2022 mints whose extensions determine the
//! account size, and the ATA program computes that correctly. Allocating it by
//! hand would mean reimplementing `GetAccountDataSize` and breaking the moment
//! an issuer adds an extension.

use {
    crate::{error::MarketError, state::*, utils::*},
    pinocchio::{
        cpi::Seed,
        error::ProgramError,
        sysvars::{clock::Clock, Sysvar},
        AccountView, ProgramResult,
    },
    pinocchio_token::{instructions::InitializeMint2, state::Mint},
};

const NARRATIVE: usize = 1;

/// Accounts:
/// 0. `[signer, writable]` creator — also the rent payer
/// 1. `[writable]` narrative PDA
/// 2. `[]` stock mint
/// 3. `[writable]` narrative mint PDA
/// 4. `[]` vault token account — for the stock mint, owned by the narrative PDA
/// 5. `[]` system program
/// 6. `[]` token program — classic SPL, for the narrative mint
/// 7. `[]` stock token program — classic SPL or Token-2022
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
    let (
        creator_key,
        stock_key,
        narrative_key,
        mint_key,
        vault_key,
        stock_program_key,
        stock_decimals,
        bump,
        mint_bump,
    ) = {
        let [creator, narrative, stock_mint, narrative_mint, vault, system_program, token_program, stock_token_program, ..] =
            &*accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_signer(creator)?;
        require_writable(narrative)?;
        require_system_program(system_program)?;
        require_token_program(token_program)?;
        require_stock_token_program(stock_token_program)?;

        // The stock mint must be an initialized mint belonging to the token
        // program the caller claims it does.
        let stock_decimals = mint_decimals(stock_mint, stock_token_program.address())?;

        let creator_key = *creator.address();
        let stock_key = *stock_mint.address();

        // Seeding on (stock, creator, name) means one creator gets one
        // narrative per name per stock, while anyone else may reuse the name.
        let (narrative_key, bump) = derive_pda(&[
            NARRATIVE_SEED,
            stock_key.as_ref(),
            creator_key.as_ref(),
            name,
        ]);
        require_address(narrative, &narrative_key)?;

        let (mint_key, mint_bump) = derive_pda(&[MINT_SEED, narrative_key.as_ref()]);
        require_address(narrative_mint, &mint_key)?;

        // The vault is whatever token account the caller supplies, so long as
        // it is for this stock and owned by this narrative. Pinned here and
        // enforced by address on every later instruction.
        token_balance_checked(
            vault,
            stock_token_program.address(),
            &stock_key,
            &narrative_key,
        )?;

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
        // Deliberately a classic SPL mint: this program creates it, so it does
        // not inherit the stock's Token-2022 requirements, and ATAs for it work
        // everywhere without extension handling.
        let mint_bump_seed = [mint_bump];
        create_pda_account(
            creator,
            narrative_mint,
            Mint::LEN,
            &TOKEN_PROGRAM,
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

        (
            creator_key,
            stock_key,
            narrative_key,
            mint_key,
            *vault.address(),
            *stock_token_program.address(),
            stock_decimals,
            bump,
            mint_bump,
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
        &stock_program_key,
        name,
        symbol,
        now,
        expiry_ts,
        base_price,
        slope,
        fee_bps,
        sell_tax_bps,
        stock_decimals,
        bump,
        mint_bump,
    )?;

    Ok(())
}
