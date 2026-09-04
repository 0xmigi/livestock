//! Shared account validation and CPI helpers.

use {
    crate::error::MarketError,
    pinocchio::{
        cpi::{Seed, Signer},
        error::{ProgramError, ProgramResult},
        sysvars::{rent::Rent, Sysvar},
        AccountView, Address,
    },
    pinocchio_system::instructions::CreateAccount,
    pinocchio_token::state::{Account as TokenAccount, Mint},
};

/// Derives a PDA and its canonical bump. Initialization paths only — the bump
/// search costs up to 255 hashes.
pub fn derive_pda(seeds: &[&[u8]]) -> (Address, u8) {
    Address::find_program_address(seeds, &crate::ID)
}

/// Confirms `account` is the PDA for `seeds + bump`, using a stored bump rather
/// than re-running the search.
pub fn verify_pda(account: &AccountView, seeds: &[&[u8]], bump: u8) -> ProgramResult {
    let bump = [bump];
    let mut with_bump: [&[u8]; 8] = [&[]; 8];
    if seeds.len() + 1 > with_bump.len() {
        return Err(MarketError::InvalidPda.into());
    }
    with_bump[..seeds.len()].copy_from_slice(seeds);
    with_bump[seeds.len()] = &bump;

    let expected = Address::create_program_address(&with_bump[..seeds.len() + 1], &crate::ID)
        .map_err(|_| ProgramError::from(MarketError::InvalidPda))?;

    if account.address() != &expected {
        return Err(MarketError::InvalidPda.into());
    }
    Ok(())
}

/// Creates a rent-exempt account at a PDA, with the PDA signing for itself.
pub fn create_pda_account(
    payer: &AccountView,
    target: &AccountView,
    space: usize,
    owner: &Address,
    seeds: &[Seed],
) -> ProgramResult {
    if target.lamports() != 0 || !target.is_data_empty() {
        return Err(MarketError::AlreadyInitialized.into());
    }

    let lamports = Rent::get()?.try_minimum_balance(space)?;

    CreateAccount {
        from: payer,
        to: target,
        lamports,
        space: space as u64,
        owner,
    }
    .invoke_signed(&[Signer::from(seeds)])
}

/// Reads a token account's balance, checking its mint and owner.
pub fn token_balance_checked(
    account: &AccountView,
    expected_mint: &Address,
    expected_owner: &Address,
) -> Result<u64, ProgramError> {
    let token_account = TokenAccount::from_account_view(account)?;
    if token_account.mint() != expected_mint || token_account.owner() != expected_owner {
        return Err(MarketError::InvalidTokenAccount.into());
    }
    Ok(token_account.amount())
}

/// Reads a token account's balance, checking only its mint.
pub fn token_balance_for_mint(
    account: &AccountView,
    expected_mint: &Address,
) -> Result<u64, ProgramError> {
    let token_account = TokenAccount::from_account_view(account)?;
    if token_account.mint() != expected_mint {
        return Err(MarketError::InvalidTokenAccount.into());
    }
    Ok(token_account.amount())
}

pub fn mint_is_initialized(account: &AccountView) -> Result<bool, ProgramError> {
    Ok(Mint::from_account_view(account)?.is_initialized())
}

pub fn require_signer(account: &AccountView) -> ProgramResult {
    if !account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

pub fn require_writable(account: &AccountView) -> ProgramResult {
    if !account.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

pub fn require_address(account: &AccountView, expected: &Address) -> ProgramResult {
    if account.address() != expected {
        return Err(MarketError::InvalidPda.into());
    }
    Ok(())
}

/// Guards against a caller substituting an attacker-controlled account.
pub fn require_program_owned(account: &AccountView) -> ProgramResult {
    if !account.owned_by(&crate::ID) {
        return Err(ProgramError::InvalidAccountOwner);
    }
    Ok(())
}

pub fn require_token_program(account: &AccountView) -> ProgramResult {
    if account.address() != &pinocchio_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

pub fn require_system_program(account: &AccountView) -> ProgramResult {
    if account.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

pub fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let end = offset
        .checked_add(8)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let bytes: [u8; 8] = data
        .get(offset..end)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    Ok(u64::from_le_bytes(bytes))
}

pub fn read_i64(data: &[u8], offset: usize) -> Result<i64, ProgramError> {
    Ok(read_u64(data, offset)? as i64)
}

pub fn read_u16(data: &[u8], offset: usize) -> Result<u16, ProgramError> {
    let end = offset
        .checked_add(2)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let bytes: [u8; 2] = data
        .get(offset..end)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    Ok(u16::from_le_bytes(bytes))
}

pub fn read_u8(data: &[u8], offset: usize) -> Result<u8, ProgramError> {
    data.get(offset)
        .copied()
        .ok_or(ProgramError::InvalidInstructionData)
}
