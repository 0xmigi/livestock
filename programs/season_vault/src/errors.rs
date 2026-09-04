use anchor_lang::prelude::*;

#[error_code]
pub enum SeasonVaultError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("A live season already exists for this vault")]
    SeasonAlreadyLive,
    #[msg("Season is not live")]
    SeasonNotLive,
    #[msg("Season is not closed")]
    SeasonNotClosed,
    #[msg("Season has not expired; only admin can close early")]
    SeasonNotExpired,
    #[msg("Season name must be 1..=32 bytes")]
    InvalidName,
    #[msg("Fee bps exceeds 10000")]
    InvalidFee,
    #[msg("Duration must be positive")]
    InvalidDuration,
    #[msg("Buy amount must be greater than zero")]
    InvalidAmount,
    #[msg("Curve produced zero tokens for this SOL amount")]
    ZeroTokensOut,
    #[msg("Market-maker inventory is insufficient for this buy")]
    InsufficientMmInventory,
    #[msg("No narrative tokens to redeem or roll")]
    NoTokens,
    #[msg("Position already redeemed")]
    AlreadyRedeemed,
    #[msg("Position already rolled")]
    AlreadyRolled,
    #[msg("Next season is invalid")]
    InvalidNextSeason,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Redeemable supply is zero")]
    NothingToRedeem,
    #[msg("Narrative mint mismatch")]
    MintMismatch,
}
