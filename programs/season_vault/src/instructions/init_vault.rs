use crate::constants::*;
use crate::errors::SeasonVaultError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub stock_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, stock_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = authority,
        token::mint = stock_mint,
        token::authority = vault,
        seeds = [STOCK_VAULT_SEED, stock_mint.key().as_ref()],
        bump
    )]
    pub stock_vault_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        token::mint = stock_mint,
        token::authority = vault,
        seeds = [MARKET_MAKER_SEED, stock_mint.key().as_ref()],
        bump
    )]
    pub market_maker_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn process(ctx: Context<InitVault>, stock_per_sol: u64) -> Result<()> {
    require!(stock_per_sol > 0, SeasonVaultError::InvalidAmount);
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.stock_mint = ctx.accounts.stock_mint.key();
    vault.stock_vault_ata = ctx.accounts.stock_vault_ata.key();
    vault.market_maker_ata = ctx.accounts.market_maker_ata.key();
    vault.live_season = Pubkey::default();
    vault.season_index = 0;
    vault.total_stock = 0;
    vault.pending_claims = 0;
    vault.stock_per_sol = stock_per_sol;
    vault.bump = ctx.bumps.vault;
    Ok(())
}
