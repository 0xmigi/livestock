use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub authority: Pubkey,
    pub stock_mint: Pubkey,
    pub stock_vault_ata: Pubkey,
    pub market_maker_ata: Pubkey,
    /// Pubkey::default() if no live season.
    pub live_season: Pubkey,
    /// Next season index to create (0-based). Incremented in create_season.
    pub season_index: u32,
    /// Cached vault ATA balance.
    pub total_stock: u64,
    /// Stock still owed to closed seasons that have not been redeemed.
    /// Rolled claims are removed from this counter so they become next-season inventory.
    pub pending_claims: u64,
    /// Demo swap: base units of stock transferred into the vault per SOL of post-fee buy.
    pub stock_per_sol: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SeasonStatus {
    Live,
    Closed,
    Settled,
}

#[account]
#[derive(InitSpace)]
pub struct Season {
    pub vault: Pubkey,
    pub index: u32,
    #[max_len(32)]
    pub name: String,
    pub narrative_mint: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub status: SeasonStatus,
    pub curve_sol_vault: Pubkey,
    pub stock_bought: u64,
    pub narrative_supply: u64,
    pub fee_bps: u16,
    pub base: u64,
    pub slope: u64,
    pub decimals: u8,
    /// Frozen at close: vault stock allocated to this season's holders.
    pub redeemable_stock: u64,
    /// Frozen at close: narrative mint supply.
    pub redeemable_supply: u64,
    pub remaining_stock: u64,
    pub remaining_supply: u64,
    pub sol_reserve: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub season: Pubkey,
    /// Cached amount burned on redeem/roll. Source of truth before then is the token balance.
    pub narrative_amount: u64,
    pub rolled: bool,
    pub redeemed: bool,
    pub bump: u8,
}
