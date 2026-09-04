use crate::constants::*;
use crate::curve::pro_rata_stock;
use crate::errors::SeasonVaultError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct Roll<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.stock_mint.as_ref()],
        bump = vault.bump,
        constraint = vault.live_season == next_season.key() @ SeasonVaultError::InvalidNextSeason,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [SEASON_SEED, vault.key().as_ref(), &season.index.to_le_bytes()],
        bump = season.bump,
        has_one = vault,
        has_one = narrative_mint,
        constraint = season.status == SeasonStatus::Closed @ SeasonVaultError::SeasonNotClosed,
    )]
    pub season: Account<'info, Season>,

    #[account(
        mut,
        seeds = [SEASON_SEED, vault.key().as_ref(), &next_season.index.to_le_bytes()],
        bump = next_season.bump,
        has_one = vault,
        constraint = next_season.key() != season.key() @ SeasonVaultError::InvalidNextSeason,
        constraint = next_season.status == SeasonStatus::Live @ SeasonVaultError::SeasonNotLive,
        constraint = next_season.narrative_mint == next_narrative_mint.key() @ SeasonVaultError::MintMismatch,
    )]
    pub next_season: Account<'info, Season>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, season.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub narrative_mint: Account<'info, Mint>,

    #[account(mut)]
    pub next_narrative_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = narrative_mint,
        associated_token::authority = owner,
        constraint = owner_narrative_ata.amount > 0 @ SeasonVaultError::NoTokens,
    )]
    pub owner_narrative_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = next_narrative_mint,
        associated_token::authority = owner,
    )]
    pub owner_next_narrative_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process(ctx: Context<Roll>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.owner.key();
        position.season = ctx.accounts.season.key();
        position.bump = ctx.bumps.position;
    }
    require!(!position.redeemed, SeasonVaultError::AlreadyRedeemed);
    require!(!position.rolled, SeasonVaultError::AlreadyRolled);

    let tokens = ctx.accounts.owner_narrative_ata.amount;
    require!(tokens > 0, SeasonVaultError::NoTokens);

    // Accounting-only claim: stock stays in the vault ATA.
    let stock_claim = pro_rata_stock(
        ctx.accounts.season.remaining_stock,
        ctx.accounts.season.remaining_supply,
        tokens,
    )?;

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.narrative_mint.to_account_info(),
                from: ctx.accounts.owner_narrative_ata.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        tokens,
    )?;

    let stock_mint = ctx.accounts.vault.stock_mint;
    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, stock_mint.as_ref(), &[bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.next_narrative_mint.to_account_info(),
                to: ctx.accounts.owner_next_narrative_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        tokens,
    )?;

    position.narrative_amount = tokens;
    position.rolled = true;

    let season = &mut ctx.accounts.season;
    season.remaining_supply = season
        .remaining_supply
        .checked_sub(tokens)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    season.remaining_stock = season
        .remaining_stock
        .checked_sub(stock_claim)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    season.narrative_supply = season
        .narrative_supply
        .checked_sub(tokens)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    if season.remaining_supply == 0 {
        season.status = SeasonStatus::Settled;
    }

    let next_season = &mut ctx.accounts.next_season;
    next_season.narrative_supply = next_season
        .narrative_supply
        .checked_add(tokens)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    // 1:1 roll is generous and can dilute organic buyers of the next season.
    // Production should use time-weighted or locked LP, not a last-hour snapshot.

    let vault = &mut ctx.accounts.vault;
    // Stock remains in the ATA; drop the old-season claim so the next close snapshot
    // includes this inventory as next-season redeemable stock.
    vault.pending_claims = vault
        .pending_claims
        .checked_sub(stock_claim)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;

    Ok(())
}
