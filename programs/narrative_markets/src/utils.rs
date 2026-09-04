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
};

/// Offsets into an SPL Token / Token-2022 token account.
const TOKEN_ACCOUNT_LEN: usize = 165;
const TOKEN_MINT_OFFSET: usize = 0;
const TOKEN_OWNER_OFFSET: usize = 32;
const TOKEN_AMOUNT_OFFSET: usize = 64;

/// Offsets into an SPL Token / Token-2022 mint.
const MINT_LEN: usize = 82;
const MINT_DECIMALS_OFFSET: usize = 44;
const MINT_INITIALIZED_OFFSET: usize = 45;

fn address_at(data: &[u8], offset: usize) -> Address {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[offset..offset + 32]);
    Address::new_from_array(bytes)
}

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

/// Reads (mint, owner, amount) from a token account.
///
/// SPL Token and Token-2022 share the same first 165 bytes, so the base fields
/// are read the same way for both. `pinocchio_token`'s typed reader cannot be
/// used here: it asserts the account is owned by the *classic* SPL Token
/// program and rejects every Token-2022 account, which is what real tokenized
/// stocks are.
fn token_account_fields(
    account: &AccountView,
    token_program: &Address,
) -> Result<(Address, Address, u64), ProgramError> {
    if !account.owned_by(token_program) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let data = account.try_borrow()?;
    if data.len() < TOKEN_ACCOUNT_LEN {
        return Err(MarketError::InvalidTokenAccount.into());
    }

    let mut amount = [0u8; 8];
    amount.copy_from_slice(&data[TOKEN_AMOUNT_OFFSET..TOKEN_AMOUNT_OFFSET + 8]);

    Ok((
        address_at(&data, TOKEN_MINT_OFFSET),
        address_at(&data, TOKEN_OWNER_OFFSET),
        u64::from_le_bytes(amount),
    ))
}

/// Reads a token account's balance, checking its token program, mint and owner.
pub fn token_balance_checked(
    account: &AccountView,
    token_program: &Address,
    expected_mint: &Address,
    expected_owner: &Address,
) -> Result<u64, ProgramError> {
    let (mint, owner, amount) = token_account_fields(account, token_program)?;
    if &mint != expected_mint || &owner != expected_owner {
        return Err(MarketError::InvalidTokenAccount.into());
    }
    Ok(amount)
}

/// Reads a token account's balance, checking its token program and mint only.
pub fn token_balance_for_mint(
    account: &AccountView,
    token_program: &Address,
    expected_mint: &Address,
) -> Result<u64, ProgramError> {
    let (mint, _owner, amount) = token_account_fields(account, token_program)?;
    if &mint != expected_mint {
        return Err(MarketError::InvalidTokenAccount.into());
    }
    Ok(amount)
}

/// Decimals of an initialized mint, for either token program.
pub fn mint_decimals(
    account: &AccountView,
    token_program: &Address,
) -> Result<u8, ProgramError> {
    Ok(read_mint(account, token_program)?.decimals)
}

/// The base fields of an SPL Token / Token-2022 mint.
pub struct MintFields {
    pub mint_authority: Option<Address>,
    pub supply: u64,
    pub decimals: u8,
    pub freeze_authority: Option<Address>,
}

/// Reads a mint's base fields for either token program.
///
/// Token-2022 mints carry their extensions after the first 82 bytes, so the
/// base layout is read the same way for both.
pub fn read_mint(
    account: &AccountView,
    token_program: &Address,
) -> Result<MintFields, ProgramError> {
    if !account.owned_by(token_program) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let data = account.try_borrow()?;
    if data.len() < MINT_LEN || data[MINT_INITIALIZED_OFFSET] == 0 {
        return Err(MarketError::InvalidTokenAccount.into());
    }

    let mut supply = [0u8; 8];
    supply.copy_from_slice(&data[36..44]);

    let option = |tag_at: usize, key_at: usize| {
        let mut tag = [0u8; 4];
        tag.copy_from_slice(&data[tag_at..tag_at + 4]);
        (u32::from_le_bytes(tag) == 1).then(|| address_at(&data, key_at))
    };

    Ok(MintFields {
        mint_authority: option(0, 4),
        supply: u64::from_le_bytes(supply),
        decimals: data[MINT_DECIMALS_OFFSET],
        freeze_authority: option(46, 50),
    })
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

/// The token program narrative mints live under — Token-2022, matching what
/// launchpads issue today.
pub fn require_narrative_token_program(account: &AccountView) -> ProgramResult {
    if account.address() != &crate::state::NARRATIVE_TOKEN_PROGRAM {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// The token program the *stock* belongs to.
///
/// Real tokenized stocks are Token-2022, so this must accept either. The
/// concrete program is recorded on the narrative at creation and every later
/// instruction checks the supplied account against it.
pub fn require_stock_token_program(account: &AccountView) -> ProgramResult {
    let key = account.address();
    if key != &crate::state::TOKEN_PROGRAM && key != &crate::state::TOKEN_2022_PROGRAM {
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
