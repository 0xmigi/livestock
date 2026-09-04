use crate::constants::*;
use crate::curve::tokens_out_for_sol;
use crate::errors::SeasonVaultError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.stock_mint.as_ref()],
        bump = vault.bump,
        has_one = stock_mint,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [SEASON_SEED, vault.key().as_ref(), &season.index.to_le_bytes()],
        bump = season.bump,
        has_one = vault,
        has_one = narrative_mint,
        constraint = vault.live_season == season.key() @ SeasonVaultError::SeasonNotLive,
        constraint = season.status == SeasonStatus::Live @ SeasonVaultError::SeasonNotLive,
    )]
    pub season: Account<'info, Season>,

    #[account(mut)]
    pub narrative_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = narrative_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_narrative_ata: Account<'info, TokenAccount>,

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
        mut,
        address = vault.market_maker_ata,
        seeds = [MARKET_MAKER_SEED, vault.stock_mint.as_ref()],
        bump,
        token::mint = stock_mint,
        token::authority = vault,
    )]
    pub market_maker_ata: Account<'info, TokenAccount>,

    /// CHECK: curve SOL treasury PDA.
    #[account(
        mut,
        seeds = [CURVE_SOL_SEED, vault.key().as_ref(), &season.index.to_le_bytes()],
        bump,
        address = season.curve_sol_vault,
    )]
    pub curve_sol_vault: UncheckedAccount<'info>,

    /// CHECK: protocol fee destination is the vault admin.
    #[account(mut, address = vault.authority)]
    pub fee_recipient: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process(ctx: Context<Buy>, amount_sol: u64) -> Result<()> {
    require!(amount_sol > 0, SeasonVaultError::InvalidAmount);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < ctx.accounts.season.end_ts,
        SeasonVaultError::SeasonNotLive
    );
    require!(
        ctx.accounts.season.status == SeasonStatus::Live,
        SeasonVaultError::SeasonNotLive
    );

    let fee = (amount_sol as u128)
        .checked_mul(ctx.accounts.season.fee_bps as u128)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        / BPS_DENOMINATOR as u128;
    let fee = u64::try_from(fee).map_err(|_| SeasonVaultError::ArithmeticOverflow)?;
    let sol_after_fee = amount_sol
        .checked_sub(fee)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    require!(sol_after_fee > 0, SeasonVaultError::InvalidAmount);

    let tokens_out = tokens_out_for_sol(
        ctx.accounts.season.base,
        ctx.accounts.season.slope,
        ctx.accounts.season.narrative_supply,
        sol_after_fee,
        ctx.accounts.season.decimals,
    )?;
    require!(tokens_out > 0, SeasonVaultError::ZeroTokensOut);

    let stock_out = (sol_after_fee as u128)
        .checked_mul(ctx.accounts.vault.stock_per_sol as u128)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?
        / LAMPORTS_PER_SOL as u128;
    let stock_out = u64::try_from(stock_out).map_err(|_| SeasonVaultError::ArithmeticOverflow)?;
    require!(
        ctx.accounts.market_maker_ata.amount >= stock_out,
        SeasonVaultError::InsufficientMmInventory
    );

    if fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.fee_recipient.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.curve_sol_vault.to_account_info(),
            },
        ),
        sol_after_fee,
    )?;

    let stock_mint = ctx.accounts.vault.stock_mint;
    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, stock_mint.as_ref(), &[bump]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.narrative_mint.to_account_info(),
                to: ctx.accounts.buyer_narrative_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        tokens_out,
    )?;

    if stock_out > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.market_maker_ata.to_account_info(),
                    to: ctx.accounts.stock_vault_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[signer_seeds],
            ),
            stock_out,
        )?;
    }

    let season = &mut ctx.accounts.season;
    season.narrative_supply = season
        .narrative_supply
        .checked_add(tokens_out)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    season.stock_bought = season
        .stock_bought
        .checked_add(stock_out)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;
    season.sol_reserve = season
        .sol_reserve
        .checked_add(sol_after_fee)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;

    let vault = &mut ctx.accounts.vault;
    vault.total_stock = vault
        .total_stock
        .checked_add(stock_out)
        .ok_or(SeasonVaultError::ArithmeticOverflow)?;

    Ok(())
}
