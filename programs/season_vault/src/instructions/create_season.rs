use crate::constants::*;
use crate::errors::SeasonVaultError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{Mint, Token};

#[derive(Accounts)]
#[instruction(name: String, duration_secs: i64, fee_bps: u16, narrative_decimals: u8)]
pub struct CreateSeason<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.stock_mint.as_ref()],
        bump = vault.bump,
        has_one = authority @ SeasonVaultError::Unauthorized,
        constraint = vault.live_season == Pubkey::default() @ SeasonVaultError::SeasonAlreadyLive,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = authority,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, vault.key().as_ref(), &vault.season_index.to_le_bytes()],
        bump
    )]
    pub season: Account<'info, Season>,

    #[account(
        init,
        payer = authority,
        mint::decimals = narrative_decimals,
        mint::authority = vault,
        mint::freeze_authority = vault,
        seeds = [NARRATIVE_MINT_SEED, vault.key().as_ref(), &vault.season_index.to_le_bytes()],
        bump
    )]
    pub narrative_mint: Account<'info, Mint>,

    /// CHECK: SOL treasury PDA for this season's curve. Funded with rent here.
    #[account(
        mut,
        seeds = [CURVE_SOL_SEED, vault.key().as_ref(), &vault.season_index.to_le_bytes()],
        bump
    )]
    pub curve_sol_vault: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn process(
    ctx: Context<CreateSeason>,
    name: String,
    duration_secs: i64,
    fee_bps: u16,
    narrative_decimals: u8,
) -> Result<()> {
    require!(
        !name.is_empty() && name.len() <= NAME_MAX_LEN,
        SeasonVaultError::InvalidName
    );
    require!(duration_secs > 0, SeasonVaultError::InvalidDuration);
    require!((fee_bps as u64) <= BPS_DENOMINATOR, SeasonVaultError::InvalidFee);
    require!(narrative_decimals <= 9, SeasonVaultError::InvalidAmount);

    let clock = Clock::get()?;
    let season_index = ctx.accounts.vault.season_index;
    let season_key = ctx.accounts.season.key();
    let mint_key = ctx.accounts.narrative_mint.key();
    let curve_key = ctx.accounts.curve_sol_vault.key();
    let bump = ctx.bumps.season;

    // Rent-exempt SOL account so later buys can credit it safely.
    let rent = Rent::get()?.minimum_balance(0);
    if ctx.accounts.curve_sol_vault.lamports() < rent {
        let top_up = rent.saturating_sub(ctx.accounts.curve_sol_vault.lamports());
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.curve_sol_vault.to_account_info(),
                },
            ),
            top_up,
        )?;
    }

    let season = &mut ctx.accounts.season;
    season.vault = ctx.accounts.vault.key();
    season.index = season_index;
    season.name = name;
    season.narrative_mint = mint_key;
    season.start_ts = clock.unix_timestamp;
    season.end_ts = clock
        .unix_timestamp
        .checked_add(duration_secs)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    season.status = SeasonStatus::Live;
    season.curve_sol_vault = curve_key;
    season.stock_bought = 0;
    season.narrative_supply = 0;
    season.fee_bps = fee_bps;
    season.base = DEFAULT_BASE;
    season.slope = DEFAULT_SLOPE;
    season.decimals = narrative_decimals;
    season.redeemable_stock = 0;
    season.redeemable_supply = 0;
    season.remaining_stock = 0;
    season.remaining_supply = 0;
    season.sol_reserve = 0;
    season.bump = bump;

    let vault = &mut ctx.accounts.vault;
    vault.live_season = season_key;
    vault.season_index = season_index
        .checked_add(1)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;

    Ok(())
}
