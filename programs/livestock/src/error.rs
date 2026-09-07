use pinocchio::error::ProgramError;

/// Program errors, surfaced as `ProgramError::Custom(n)`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MarketError {
    /// The narrative is not accepting curve trades.
    NotLive = 0,
    /// The narrative has not been expired yet.
    NotExpired = 1,
    /// `expiry_ts` has already passed.
    Expired = 2,
    /// `expire` was called before `expiry_ts`.
    TooEarly = 3,
    /// The requested expiry is outside the permitted window.
    BadExpiry = 4,
    /// Curve parameters or fees are out of range.
    BadParameters = 5,
    /// An amount was zero where it must not be.
    ZeroAmount = 6,
    /// Arithmetic overflowed or underflowed.
    MathOverflow = 7,
    /// Cost exceeded, or proceeds fell short of, the caller's limit.
    SlippageExceeded = 8,
    /// The caller holds no narrative tokens.
    NothingToRedeem = 9,
    /// An account did not match its expected PDA.
    InvalidPda = 10,
    /// A token account's mint or owner is wrong.
    InvalidTokenAccount = 11,
    /// Instruction data was malformed.
    InvalidInstructionData = 12,
    /// The account is already initialized.
    AlreadyInitialized = 13,
    /// Selling more tokens than exist on the curve.
    InsufficientSupply = 14,
    /// The curve has sold every token it will ever sell.
    SoldOut = 15,
}

impl From<MarketError> for ProgramError {
    fn from(e: MarketError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
