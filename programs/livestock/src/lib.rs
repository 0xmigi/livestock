//! # Livestock
//!
//! Short-lived tokens about a specific story concerning a public company, which
//! **expire into that company's tokenized stock**.
//!
//! Buyers pay dollars, but the curve is denominated in the stock — see
//! [`curve`] for why that is load-bearing rather than incidental.
//!
//! Invariants this program enforces:
//!
//! 1. `expiry_ts` is fixed at creation and can never move.
//! 2. Buys and sells re-check the clock every transaction; both stop at expiry.
//! 3. `expire` cannot be called early by anyone, the creator included.
//! 4. Narrative tokens are only minted by the curve. The mint authority is a
//!    program PDA and is revoked at expiry.
//! 5. The creator can never move stock out of the vault.
//! 6. Redemption claims never expire.
//! 7. At expiry every holder can be paid out without their signature: the
//!    narrative is the mint's permanent delegate, and `convert` is
//!    permissionless.

#![allow(unexpected_cfgs)]

pub mod curve;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use pinocchio::{
    entrypoint,
    error::{ProgramError, ToStr},
    AccountView, Address, ProgramResult,
};

/// On-chain address of this program.
pub const ID: Address = Address::from_str_const("5X7RTCFFLgCpsRiskzm1gBEQmbzBEL39H6WpN9YzSizB");

entrypoint!(process_instruction);

/// Instruction discriminators — the first byte of every payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Instruction {
    CreateNarrative = 0,
    Buy = 1,
    Sell = 2,
    Expire = 3,
    Redeem = 4,
    Convert = 5,
}

fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    let Some((discriminator, data)) = instruction_data.split_first() else {
        return Err(ProgramError::InvalidInstructionData);
    };

    match *discriminator {
        x if x == Instruction::CreateNarrative as u8 => {
            instructions::create_narrative(accounts, data)
        }
        x if x == Instruction::Buy as u8 => instructions::buy(accounts, data),
        x if x == Instruction::Sell as u8 => instructions::sell(accounts, data),
        x if x == Instruction::Expire as u8 => instructions::expire(accounts),
        x if x == Instruction::Redeem as u8 => instructions::redeem(accounts),
        x if x == Instruction::Convert as u8 => instructions::convert(accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Renders custom errors in transaction logs.
impl ToStr for error::MarketError {
    fn to_str(&self) -> &'static str {
        use error::MarketError::*;
        match self {
            NotLive => "narrative is not live",
            NotExpired => "narrative has not been expired yet",
            Expired => "narrative has expired",
            TooEarly => "narrative cannot be expired before expiry_ts",
            BadExpiry => "expiry must be between 1 hour and 90 days out",
            BadParameters => "curve parameters or fees out of range",
            ZeroAmount => "amount must be greater than zero",
            MathOverflow => "arithmetic overflow",
            SlippageExceeded => "price moved past your limit",
            NothingToRedeem => "you hold no tokens for this narrative",
            InvalidPda => "account does not match its expected address",
            InvalidTokenAccount => "token account mint or owner mismatch",
            InvalidInstructionData => "malformed instruction data",
            AlreadyInitialized => "account already initialized",
            InsufficientSupply => "not enough supply on the curve",
            SoldOut => "the curve has sold out",
        }
    }
}
