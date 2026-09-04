//! `create_narrative(expiry_ts, base_price, slope, fee_bps, sell_tax_bps, name, symbol)`
//!
//! Permissionless. Anyone can launch a narrative against any stock mint.
//!
//! The expiry written here never becomes writable again — no instruction in
//! this program can move it, the creator included.
//!
//! # The mint and the vault are supplied, not created
//!
//! Both arrive already built and this instruction only *verifies* them.
//!
//! The narrative mint is a Token-2022 mint carrying its name, symbol and URI
//! in the mint's own `TokenMetadata` extension — the shape launchpads issue
//! today. Building that on-chain would mean hand-rolling extension CPIs that
//! have no Pinocchio bindings; the client has proper builders for all of it.
//! Being a plain keypair rather than a PDA is also what lets a creator grind a
//! vanity address, as every launchpad does.
//!
//! The vault is an associated token account for the stock. Tokenized stocks
//! are Token-2022 mints whose extensions determine account size, and the ATA
//! program computes that correctly.
//!
//! What the program will not take on trust: the mint must be Token-2022, have
//! zero decimals, have **no supply yet**, carry **no freeze authority**, and
//! have already handed its **mint authority to this narrative's PDA**. Without
//! that last check anyone could keep minting beside the curve.

use {
    crate::{error::MarketError, state::*, utils::*},
    pinocchio::{
        cpi::Seed,
        error::ProgramError,
        sysvars::{clock::Clock, Sysvar},
        AccountView, ProgramResult,
    },
};

const NARRATIVE: usize = 1;

/// Accounts:
/// 0. `[signer, writable]` creator — also the rent payer
/// 1. `[writable]` narrative PDA
/// 2. `[]` stock mint
/// 3. `[]` narrative mint — Token-2022, pre-created, authority already handed over
/// 4. `[]` vault token account — for the stock mint, owned by the narrative PDA
/// 5. `[]` system program
/// 6. `[]` stock token program — classic SPL or Token-2022
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

    // --- verify the supplied accounts ------------------------------------
    let (
        creator_key,
        stock_key,
        mint_key,
        vault_key,
        stock_program_key,
        stock_decimals,
        bump,
    ) = {
        let [creator, narrative, stock_mint, narrative_mint, vault, system_program, stock_token_program, ..] =
            &*accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        require_signer(creator)?;
        require_writable(narrative)?;
        require_system_program(system_program)?;
        require_stock_token_program(stock_token_program)?;

        // The stock must be an initialized mint under the program it claims.
        let stock_decimals = mint_decimals(stock_mint, stock_token_program.address())?;

        let creator_key = *creator.address();
        let stock_key = *stock_mint.address();
        let mint_key = *narrative_mint.address();

        // One narrative per mint, and the mint is a keypair the creator brings.
        let (narrative_key, bump) = derive_pda(&[NARRATIVE_SEED, mint_key.as_ref()]);
        require_address(narrative, &narrative_key)?;

        // --- the narrative mint must already be handed over ----------------
        let mint = read_mint(narrative_mint, &NARRATIVE_TOKEN_PROGRAM)?;
        if mint.decimals != NARRATIVE_DECIMALS {
            return Err(MarketError::BadParameters.into());
        }
        // Nothing may exist before the curve mints it.
        if mint.supply != 0 {
            return Err(MarketError::BadParameters.into());
        }
        // A freeze authority would let someone strand holders' tokens.
        if mint.freeze_authority.is_some() {
            return Err(MarketError::BadParameters.into());
        }
        // Only this narrative may mint. Without this the curve means nothing.
        if mint.mint_authority != Some(narrative_key) {
            return Err(MarketError::BadParameters.into());
        }

        // The vault is pinned here and enforced by address on every later
        // instruction.
        token_balance_checked(
            vault,
            stock_token_program.address(),
            &stock_key,
            &narrative_key,
        )?;

        // --- the one account this program does create ----------------------
        let bump_seed = [bump];
        create_pda_account(
            creator,
            narrative,
            NARRATIVE_LEN,
            &crate::ID,
            &[
                Seed::from(NARRATIVE_SEED),
                Seed::from(mint_key.as_ref()),
                Seed::from(&bump_seed),
            ],
        )?;

        (
            creator_key,
            stock_key,
            mint_key,
            *vault.address(),
            *stock_token_program.address(),
            stock_decimals,
            bump,
        )
    };

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
    )?;

    Ok(())
}
