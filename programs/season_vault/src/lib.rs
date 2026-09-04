use anchor_lang::prelude::*;

pub mod constants;
pub mod curve;
pub mod errors;
pub mod instructions;
pub mod state;

#[allow(unused_imports)]
use instructions::buy::{Buy, __client_accounts_buy};
#[allow(unused_imports)]
use instructions::close_season::{CloseSeason, __client_accounts_close_season};
#[allow(unused_imports)]
use instructions::create_season::{CreateSeason, __client_accounts_create_season};
#[allow(unused_imports)]
use instructions::init_vault::{InitVault, __client_accounts_init_vault};
#[allow(unused_imports)]
use instructions::redeem::{Redeem, __client_accounts_redeem};
#[allow(unused_imports)]
use instructions::roll::{Roll, __client_accounts_roll};

declare_id!("5XUdp44mcYjdG4WhqYYAMAkAHcrFeKnfMWPFUdpi5rCq");

#[program]
pub mod season_vault {
    use super::*;

    /// Create the vault PDA, stock ATA, and demo market-maker ATA.
    /// `stock_per_sol` is the prototype swap rate (base units of stock per 1 SOL of post-fee buy).
    pub fn init_vault(ctx: Context<InitVault>, stock_per_sol: u64) -> Result<()> {
        instructions::init_vault::process(ctx, stock_per_sol)
    }

    /// Open a live season. Fails if one is already live. Same instruction is used for season N+1.
    pub fn create_season(
        ctx: Context<CreateSeason>,
        name: String,
        duration_secs: i64,
        fee_bps: u16,
        narrative_decimals: u8,
    ) -> Result<()> {
        instructions::create_season::process(ctx, name, duration_secs, fee_bps, narrative_decimals)
    }

    /// Buy narrative tokens along the linear SOL curve. Buys only — no sells in MVP.
    pub fn buy(ctx: Context<Buy>, amount_sol: u64) -> Result<()> {
        instructions::buy::process(ctx, amount_sol)
    }

    /// Close the live season. Anyone after `end_ts`, or admin anytime. Snapshots redeemable inventory.
    pub fn close_season(ctx: Context<CloseSeason>) -> Result<()> {
        instructions::close_season::process(ctx)
    }

    /// Burn narrative tokens and receive pro-rata stock from the close snapshot.
    pub fn redeem(ctx: Context<Redeem>) -> Result<()> {
        instructions::redeem::process(ctx)
    }

    /// Burn season-N tokens and mint the same amount of season-(N+1) tokens. Stock stays in the vault.
    pub fn roll(ctx: Context<Roll>) -> Result<()> {
        instructions::roll::process(ctx)
    }
}
