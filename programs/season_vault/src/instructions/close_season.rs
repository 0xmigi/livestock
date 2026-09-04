use crate::constants::*;
use crate::errors::SeasonVaultError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, spl_token::instruction::AuthorityType, Mint, SetAuthority, Token, TokenAccount};

#[derive(Accounts)]
pub struct CloseSeason<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.stock_mint.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [SEASON_SEED, vault.key().as_ref(), &season.index.to_le_bytes()],
        bump = season.bump,
        has_one = vault,
        has_one = narrative_mint,
        constraint = season.status == SeasonStatus::Live @ SeasonVaultError::SeasonNotLive,
        constraint = vault.live_season == season.key() @ SeasonVaultError::SeasonNotLive,
    )]
    pub season: Account<'info, Season>,

    #[account(
        address = vault.stock_vault_ata,
        seeds = [STOCK_VAULT_SEED, vault.stock_mint.as_ref()],
        bump,
    )]
    pub stock_vault_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub narrative_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn process(ctx: Context<CloseSeason>) -> Result<()> {
    let clock = Clock::get()?;
    let is_admin = ctx.accounts.caller.key() == ctx.accounts.vault.authority;
    require!(
        is_admin || clock.unix_timestamp >= ctx.accounts.season.end_ts,
        SeasonVaultError::SeasonNotExpired
    );

    let ata_amount = ctx.accounts.stock_vault_ata.amount;
    let pending = ctx.accounts.vault.pending_claims;
    let redeemable_stock = ata_amount.saturating_sub(pending);
    let redeemable_supply = ctx.accounts.narrative_mint.supply;

    // Revoke mint authority so no more season-N tokens can be minted.
    // Burn still works (needed for redeem/roll). Freeze of holder accounts is skipped
    // because a frozen account cannot burn.
    let stock_mint = ctx.accounts.vault.stock_mint;
    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, stock_mint.as_ref(), &[bump]];
    token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.vault.to_account_info(),
                account_or_mint: ctx.accounts.narrative_mint.to_account_info(),
            },
            &[signer_seeds],
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    let season = &mut ctx.accounts.season;
    season.redeemable_stock = redeemable_stock;
    season.redeemable_supply = redeemable_supply;
    season.remaining_stock = redeemable_stock;
    season.remaining_supply = redeemable_supply;
    season.narrative_supply = redeemable_supply;
    season.status = if redeemable_supply == 0 {
        SeasonStatus::Settled
    } else {
        SeasonStatus::Closed
    };

    let vault = &mut ctx.accounts.vault;
    vault.live_season = Pubkey::default();
    vault.total_stock = ata_amount;
    vault.pending_claims = pending
        .checked_add(redeemable_stock)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;

    Ok(())
}
