use crate::constants::*;
use crate::curve::pro_rata_stock;
use crate::errors::SeasonVaultError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

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
        constraint = (season.status == SeasonStatus::Closed
            || season.status == SeasonStatus::Settled)
            @ SeasonVaultError::SeasonNotClosed,
    )]
    pub season: Account<'info, Season>,

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

    #[account(
        mut,
        associated_token::mint = narrative_mint,
        associated_token::authority = owner,
        constraint = owner_narrative_ata.amount > 0 @ SeasonVaultError::NoTokens,
    )]
    pub owner_narrative_ata: Account<'info, TokenAccount>,

    pub stock_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = vault.stock_vault_ata,
        seeds = [STOCK_VAULT_SEED, vault.stock_mint.as_ref()],
        bump,
        token::mint = stock_mint,
        token::authority = vault,
    )]
    pub stock_vault_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = stock_mint,
        associated_token::authority = owner,
    )]
    pub owner_stock_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process(ctx: Context<Redeem>) -> Result<()> {
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

    let stock_out = pro_rata_stock(
        ctx.accounts.season.remaining_stock,
        ctx.accounts.season.remaining_supply,
        tokens,
    )?;
    require!(
        ctx.accounts.stock_vault_ata.amount >= stock_out,
        SeasonVaultError::InsufficientMmInventory
    );

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

    if stock_out > 0 {
        let stock_mint = ctx.accounts.vault.stock_mint;
        let bump = ctx.accounts.vault.bump;
        let signer_seeds: &[&[u8]] = &[VAULT_SEED, stock_mint.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stock_vault_ata.to_account_info(),
                    to: ctx.accounts.owner_stock_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[signer_seeds],
            ),
            stock_out,
        )?;
    }

    position.narrative_amount = tokens;
    position.redeemed = true;

    let season = &mut ctx.accounts.season;
    season.remaining_supply = season
        .remaining_supply
        .checked_sub(tokens)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    season.remaining_stock = season
        .remaining_stock
        .checked_sub(stock_out)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    season.narrative_supply = season
        .narrative_supply
        .checked_sub(tokens)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    if season.remaining_supply == 0 {
        season.status = SeasonStatus::Settled;
    }

    let vault = &mut ctx.accounts.vault;
    vault.total_stock = vault
        .total_stock
        .checked_sub(stock_out)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    vault.pending_claims = vault
        .pending_claims
        .checked_sub(stock_out)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;

    Ok(())
}
