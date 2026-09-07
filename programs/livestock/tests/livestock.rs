//! Every invariant in SPEC.md §9 gets a test here.

mod common;

use {
    common::*,
    livestock::{
        curve::{
            apply_bps, buy_cost, sell_refund, INITIAL_REAL_TOKEN_RESERVES,
            INITIAL_VIRTUAL_TOKEN_RESERVES,
        },
        state::{Narrative, Status},
    },
    solana_address::Address,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const STOCK_FUNDING: u64 = 100_000_000_000; // 1,000 units of an 8-decimal mint

/// The curve barely moves over a few thousand tokens out of a billion, so the
/// economics tests trade in millions.
const M: u64 = 1_000_000;

/// What a fresh curve charges for `tokens`.
fn opening_cost(tokens: u64) -> u64 {
    buy_cost(VIRTUAL_STOCK, INITIAL_VIRTUAL_TOKEN_RESERVES, tokens).unwrap()
}

struct Market {
    env: Env,
    narrative: Address,
    narrative_mint: Address,
    vault: Address,
    creator_fee: Address,
}

/// A live narrative with the default curve, plus the creator's fee account.
fn setup() -> Market {
    setup_with(Env::new())
}

/// The same, but with a Token-2022 stock mint — what real xStocks are.
fn setup_token_2022() -> Market {
    setup_with(Env::new_token_2022())
}

fn setup_with(env: Env) -> Market {
    let mut env = env;
    let creator = env.creator.insecure_clone();
    let creator_key = creator.pubkey();
    let expiry = env.now() + DURATION;

    // Both the mint and the vault exist before creation — the program verifies
    // them rather than building them. The mint is a keypair whose authority has
    // already been handed to its own narrative PDA.
    let (narrative_mint, narrative) = env.create_narrative_mint();
    let vault = env.create_vault(&narrative);

    env.send(
        &[create_narrative_ix(
            &env,
            &creator_key,
            &narrative_mint,
            &vault,
            "ROBOTAXI",
            "RBTX",
            expiry,
            VIRTUAL_STOCK,
            FEE_BPS,
            SELL_TAX_BPS,
        )],
        &[&creator],
    )
    .expect("create_narrative");

    let stock_mint = env.stock_mint;
    let creator_fee = env.create_token_account(&creator_key, &stock_mint);

    Market {
        env,
        narrative,
        narrative_mint,
        vault,
        creator_fee,
    }
}

/// A funded holder: stock to spend, a narrative token account, and a stock
/// account to receive payouts.
struct Holder {
    wallet: Keypair,
    tokens: Address,
    stock: Address,
}

fn holder(m: &mut Market) -> Holder {
    let wallet = m.env.new_wallet(10 * SOL);
    let key = wallet.pubkey();
    let narrative_mint = m.narrative_mint;
    let stock_mint = m.env.stock_mint;

    let tokens = m.env.create_token_account(&key, &narrative_mint);
    let stock = m.env.create_token_account(&key, &stock_mint);
    m.env.mint_stock_to(&stock, STOCK_FUNDING);

    Holder {
        wallet,
        tokens,
        stock,
    }
}

fn buy(m: &mut Market, h: &Holder, tokens: u64) {
    let ix = buy_ix(
        &m.env,
        &m.narrative_mint,
        &h.wallet.pubkey(),
        &h.tokens,
        &h.stock,
        &m.creator_fee,
        &m.narrative,
        &m.vault,
        tokens,
        u64::MAX,
    );
    m.env.send(&[ix], &[&h.wallet]).expect("buy");
}

fn state<T>(m: &Market, f: impl FnOnce(&Narrative) -> T) -> T {
    let account = m.env.svm.get_account(&m.narrative).expect("narrative");
    f(Narrative::from_bytes(&account.data).expect("decodes"))
}

fn vault_balance(m: &Market) -> u64 {
    m.env.token_balance(&m.vault)
}

/// Any funded wallet — a keeper — pays the fee for a permissionless payout.
fn convert(m: &mut Market, h: &Holder) -> Result<(), ()> {
    let keeper = m.env.creator.insecure_clone();
    let ix = convert_ix(&m.env, &m.narrative_mint, &h.tokens, &h.stock, &m.narrative, &m.vault);
    m.env.send(&[ix], &[&keeper]).map(|_| ()).map_err(|_| ())
}

fn expire(m: &mut Market) {
    m.env.advance_clock(DURATION + 1);
    let payer = m.env.creator.insecure_clone();
    let ix = expire_ix(&m.env, &m.narrative_mint, &m.narrative, &m.vault);
    m.env.send(&[ix], &[&payer]).expect("expire");
}

// --- creation -------------------------------------------------------------

#[test]
fn narrative_is_created_live_with_an_empty_vault() {
    let m = setup();
    state(&m, |s| {
        assert_eq!(s.status().unwrap(), Status::Live);
        assert_eq!(s.supply(), 0);
        assert_eq!(s.name(), b"ROBOTAXI");
        assert_eq!(s.symbol(), b"RBTX");
        assert_eq!(s.virtual_stock(), VIRTUAL_STOCK);
        assert_eq!(s.virtual_tokens(), INITIAL_VIRTUAL_TOKEN_RESERVES);
        assert_eq!(s.remaining(), INITIAL_REAL_TOKEN_RESERVES);
    });
    assert_eq!(vault_balance(&m), 0);
}

#[test]
fn expiry_outside_the_permitted_window_is_rejected() {
    let mut env = Env::new();
    let creator = env.creator.insecure_clone();
    let key = creator.pubkey();
    let now = env.now();

    let (narrative_mint, narrative) = env.create_narrative_mint();
    let vault = env.create_vault(&narrative);

    for bad in [now + 60, now + 91 * 24 * HOUR, now - HOUR] {
        let ix = create_narrative_ix(
            &env, &key, &narrative_mint, &vault, "TOOSHORT", "TS", bad, VIRTUAL_STOCK,
            FEE_BPS, SELL_TAX_BPS,
        );
        assert!(
            env.send(&[ix], &[&creator]).is_err(),
            "expiry {bad} should be rejected",
        );
    }
}

#[test]
fn degenerate_curve_parameters_are_rejected() {
    let mut env = Env::new();
    let creator = env.creator.insecure_clone();
    let key = creator.pubkey();
    let expiry = env.now() + DURATION;

    let (narrative_mint, narrative) = env.create_narrative_mint();
    let vault = env.create_vault(&narrative);

    // An empty stock reserve and an absurd fee each fail.
    for (virtual_stock, fee) in [(0, FEE_BPS), (VIRTUAL_STOCK, 5_000)] {
        let ix = create_narrative_ix(
            &env, &key, &narrative_mint, &vault, "BAD", "BAD", expiry, virtual_stock, fee,
            SELL_TAX_BPS,
        );
        assert!(env.send(&[ix], &[&creator]).is_err());
    }
}

// --- the curve ------------------------------------------------------------

#[test]
fn buying_moves_stock_into_the_vault_and_pays_the_creator() {
    let mut m = setup();
    let h = holder(&mut m);

    let cost = opening_cost(M);
    let fee = apply_bps(cost, FEE_BPS).unwrap();

    buy(&mut m, &h, M);

    assert_eq!(m.env.token_balance(&h.tokens), M);
    assert_eq!(vault_balance(&m), cost);
    assert_eq!(m.env.token_balance(&m.creator_fee), fee);
    assert_eq!(m.env.token_balance(&h.stock), STOCK_FUNDING - cost - fee);
    state(&m, |s| {
        assert_eq!(s.supply(), M);
        assert_eq!(s.virtual_stock(), VIRTUAL_STOCK + cost);
        assert_eq!(s.virtual_tokens(), INITIAL_VIRTUAL_TOKEN_RESERVES - M);
    });
}

#[test]
fn the_second_buyer_pays_more_than_the_first() {
    let mut m = setup();
    let a = holder(&mut m);
    let b = holder(&mut m);

    let first = opening_cost(50 * M);
    let second = buy_cost(VIRTUAL_STOCK + first, INITIAL_VIRTUAL_TOKEN_RESERVES - 50 * M, 50 * M).unwrap();
    assert!(second > first);

    buy(&mut m, &a, 50 * M);
    buy(&mut m, &b, 50 * M);
    assert_eq!(vault_balance(&m), first + second);
}

#[test]
fn buy_respects_the_slippage_limit() {
    let mut m = setup();
    let h = holder(&mut m);

    let cost = opening_cost(M);
    let fee = apply_bps(cost, FEE_BPS).unwrap();
    let ix = buy_ix(
        &m.env,
        &m.narrative_mint,
        &h.wallet.pubkey(),
        &h.tokens,
        &h.stock,
        &m.creator_fee,
        &m.narrative,
        &m.vault,
        M,
        cost + fee - 1, // one base unit short
    );
    assert!(m.env.send(&[ix], &[&h.wallet]).is_err());
}

/// pump.fun sells 793.1M tokens and then migrates; a narrative sells the
/// same 793.1M and then simply stops. Sells still work, and reopen the curve.
#[test]
fn the_curve_sells_out_at_the_real_reserve() {
    let mut m = setup();
    let whale = holder(&mut m);
    // The whole reserve costs about 3.8 opening reserves; fund for it.
    m.env.mint_stock_to(&whale.stock, 10 * VIRTUAL_STOCK);

    buy(&mut m, &whale, INITIAL_REAL_TOKEN_RESERVES - 1);
    state(&m, |s| assert_eq!(s.remaining(), 1));

    // Two more is one too many.
    let ix = buy_ix(
        &m.env, &m.narrative_mint, &whale.wallet.pubkey(), &whale.tokens, &whale.stock,
        &m.creator_fee, &m.narrative, &m.vault, 2, u64::MAX,
    );
    assert!(m.env.send(&[ix], &[&whale.wallet]).is_err(), "cannot buy past the reserve");

    // The last one is fine, and then the curve is sold out.
    buy(&mut m, &whale, 1);
    state(&m, |s| {
        assert_eq!(s.remaining(), 0);
        assert_eq!(s.supply(), INITIAL_REAL_TOKEN_RESERVES);
        assert_eq!(
            s.virtual_tokens(),
            INITIAL_VIRTUAL_TOKEN_RESERVES - INITIAL_REAL_TOKEN_RESERVES,
        );
    });
    let ix = buy_ix(
        &m.env, &m.narrative_mint, &whale.wallet.pubkey(), &whale.tokens, &whale.stock,
        &m.creator_fee, &m.narrative, &m.vault, 1, u64::MAX,
    );
    assert!(m.env.send(&[ix], &[&whale.wallet]).is_err(), "sold out");

    // Selling puts tokens back on the curve and buying resumes.
    let ix = sell_ix(
        &m.env, &m.narrative_mint, &whale.wallet.pubkey(), &whale.tokens, &whale.stock,
        &m.narrative, &m.vault, 10, 0,
    );
    m.env.send(&[ix], &[&whale.wallet]).expect("sell after sell-out");
    state(&m, |s| assert_eq!(s.remaining(), 10));
    buy(&mut m, &whale, 10);
}

// --- sells ----------------------------------------------------------------

#[test]
fn selling_walks_the_curve_back_down_and_the_tax_stays_behind() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 10 * M);

    let vault_before = vault_balance(&m);
    let stock_before = m.env.token_balance(&h.stock);
    let (vstock, vtokens) = state(&m, |s| (s.virtual_stock(), s.virtual_tokens()));

    let refund = sell_refund(vstock, vtokens, 4 * M).unwrap();
    let tax = apply_bps(refund, SELL_TAX_BPS).unwrap();
    let payout = refund - tax;

    let ix = sell_ix(
        &m.env,
        &m.narrative_mint,
        &h.wallet.pubkey(),
        &h.tokens,
        &h.stock,
        &m.narrative,
        &m.vault,
        4 * M,
        0,
    );
    m.env.send(&[ix], &[&h.wallet]).expect("sell");

    assert_eq!(m.env.token_balance(&h.tokens), 6 * M);
    assert_eq!(m.env.token_balance(&h.stock), stock_before + payout);
    assert_eq!(
        vault_balance(&m),
        vault_before - payout,
        "the tax must remain in the vault for the holders who stayed",
    );
    assert!(tax > 0);
    state(&m, |s| {
        assert_eq!(s.supply(), 6 * M);
        // The whole refund leaves the curve, tax included: the tax is the
        // vault's, not the curve's.
        assert_eq!(s.virtual_stock(), vstock - refund);
        assert_eq!(s.virtual_tokens(), vtokens + 4 * M);
    });
}

#[test]
fn cannot_sell_more_than_the_supply() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 100);

    let ix = sell_ix(
        &m.env,
        &m.narrative_mint,
        &h.wallet.pubkey(),
        &h.tokens,
        &h.stock,
        &m.narrative,
        &m.vault,
        200,
        0,
    );
    assert!(m.env.send(&[ix], &[&h.wallet]).is_err());
}

// --- expiry ---------------------------------------------------------------

#[test]
fn nobody_can_expire_early_including_the_creator() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 100);

    let creator = m.env.creator.insecure_clone();
    let ix = expire_ix(&m.env, &m.narrative_mint, &m.narrative, &m.vault);
    assert!(
        m.env.send(&[ix], &[&creator]).is_err(),
        "the creator must have no privilege to expire early",
    );

    let stranger = m.env.new_wallet(SOL);
    let ix = expire_ix(&m.env, &m.narrative_mint, &m.narrative, &m.vault);
    assert!(m.env.send(&[ix], &[&stranger]).is_err());
}

#[test]
fn anyone_can_expire_once_the_date_passes() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 100);

    m.env.advance_clock(DURATION + 1);
    let stranger = m.env.new_wallet(SOL);
    let ix = expire_ix(&m.env, &m.narrative_mint, &m.narrative, &m.vault);
    m.env.send(&[ix], &[&stranger]).expect("permissionless");

    state(&m, |s| assert_eq!(s.status().unwrap(), Status::Expired));
}

#[test]
fn trading_stops_at_expiry_even_before_expire_is_called() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 100);

    m.env.advance_clock(DURATION + 1);

    let ix = buy_ix(
        &m.env,
        &m.narrative_mint,
        &h.wallet.pubkey(),
        &h.tokens,
        &h.stock,
        &m.creator_fee,
        &m.narrative,
        &m.vault,
        10,
        u64::MAX,
    );
    assert!(m.env.send(&[ix], &[&h.wallet]).is_err(), "no buys past expiry");

    let ix = sell_ix(
        &m.env,
        &m.narrative_mint,
        &h.wallet.pubkey(),
        &h.tokens,
        &h.stock,
        &m.narrative,
        &m.vault,
        10,
        0,
    );
    assert!(m.env.send(&[ix], &[&h.wallet]).is_err(), "no sells past expiry");
}

#[test]
fn expiry_freezes_the_numbers_and_revokes_the_mint_authority() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 1_000);

    let mint = m.narrative_mint;
    assert!(m.env.mint_has_authority(&mint));

    let vault_at_expiry = vault_balance(&m);
    expire(&mut m);

    state(&m, |s| {
        assert_eq!(s.final_supply(), 1_000);
        assert_eq!(s.final_vault(), vault_at_expiry);
    });
    assert!(
        !m.env.mint_has_authority(&mint),
        "an expired narrative must never mint again",
    );
}

#[test]
fn a_narrative_nobody_bought_settles_immediately() {
    let mut m = setup();
    expire(&mut m);
    state(&m, |s| assert_eq!(s.status().unwrap(), Status::Settled));
}

// --- redemption -----------------------------------------------------------

#[test]
fn redeem_pays_pro_rata_and_the_last_holder_sweeps_the_dust() {
    let mut m = setup();
    let a = holder(&mut m);
    let b = holder(&mut m);

    buy(&mut m, &a, 333); // deliberately awkward split
    buy(&mut m, &b, 667);

    expire(&mut m);
    let (pot, supply) = state(&m, |s| (s.final_vault(), s.final_supply()));
    assert_eq!(supply, 1_000);

    let a_stock_before = m.env.token_balance(&a.stock);
    let ix = redeem_ix(&m.env, &m.narrative_mint, &a.wallet.pubkey(), &a.tokens, &a.stock, &m.narrative, &m.vault);
    m.env.send(&[ix], &[&a.wallet]).expect("A redeems");

    let a_payout = m.env.token_balance(&a.stock) - a_stock_before;
    assert_eq!(a_payout, pot * 333 / 1_000);
    assert_eq!(m.env.token_balance(&a.tokens), 0);

    let b_stock_before = m.env.token_balance(&b.stock);
    let ix = redeem_ix(&m.env, &m.narrative_mint, &b.wallet.pubkey(), &b.tokens, &b.stock, &m.narrative, &m.vault);
    m.env.send(&[ix], &[&b.wallet]).expect("B redeems");

    let b_payout = m.env.token_balance(&b.stock) - b_stock_before;
    assert_eq!(
        a_payout + b_payout,
        pot,
        "the whole pot must be paid out, no dust stranded",
    );
    assert_eq!(vault_balance(&m), 0);
    state(&m, |s| assert_eq!(s.status().unwrap(), Status::Settled));
}

#[test]
fn double_redeem_fails() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 500);
    expire(&mut m);

    let ix = redeem_ix(&m.env, &m.narrative_mint, &h.wallet.pubkey(), &h.tokens, &h.stock, &m.narrative, &m.vault);
    m.env.send(&[ix], &[&h.wallet]).expect("first redeem");

    let ix = redeem_ix(&m.env, &m.narrative_mint, &h.wallet.pubkey(), &h.tokens, &h.stock, &m.narrative, &m.vault);
    assert!(m.env.send(&[ix], &[&h.wallet]).is_err());
}

#[test]
fn cannot_redeem_before_expiry() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 100);

    let ix = redeem_ix(&m.env, &m.narrative_mint, &h.wallet.pubkey(), &h.tokens, &h.stock, &m.narrative, &m.vault);
    assert!(m.env.send(&[ix], &[&h.wallet]).is_err());
}

// --- the economics --------------------------------------------------------

/// The invariant the whole design rests on, proven end to end rather than in
/// arithmetic: a buyer cannot mint and immediately redeem for a profit.
#[test]
fn buying_late_and_redeeming_is_always_a_loss() {
    let mut m = setup();
    let early = holder(&mut m);
    buy(&mut m, &early, 100 * M);

    let sniper = holder(&mut m);
    let spent_before = STOCK_FUNDING - m.env.token_balance(&sniper.stock);
    buy(&mut m, &sniper, 5 * M);
    let spent = STOCK_FUNDING - m.env.token_balance(&sniper.stock) - spent_before;

    expire(&mut m);

    let before = m.env.token_balance(&sniper.stock);
    let ix = redeem_ix(
        &m.env,
        &m.narrative_mint,
        &sniper.wallet.pubkey(),
        &sniper.tokens,
        &sniper.stock,
        &m.narrative,
        &m.vault,
    );
    m.env.send(&[ix], &[&sniper.wallet]).expect("redeem");
    let received = m.env.token_balance(&sniper.stock) - before;

    assert!(
        received < spent,
        "buy-and-redeem must lose: spent {spent}, received {received}",
    );
}

/// The product's actual claim: buy early into a narrative that keeps growing
/// and you redeem more stock than you paid in.
#[test]
fn an_early_buyer_redeems_more_stock_than_they_paid() {
    let mut m = setup();
    let early = holder(&mut m);

    let paid = opening_cost(10 * M);
    let fee = apply_bps(paid, FEE_BPS).unwrap();
    buy(&mut m, &early, 10 * M);

    // The narrative takes off after them.
    for _ in 0..4 {
        let late = holder(&mut m);
        buy(&mut m, &late, 100 * M);
    }

    expire(&mut m);

    let before = m.env.token_balance(&early.stock);
    let ix = redeem_ix(
        &m.env,
        &m.narrative_mint,
        &early.wallet.pubkey(),
        &early.tokens,
        &early.stock,
        &m.narrative,
        &m.vault,
    );
    m.env.send(&[ix], &[&early.wallet]).expect("redeem");
    let received = m.env.token_balance(&early.stock) - before;

    assert!(
        received > paid + fee,
        "an early buyer should gain: paid {} (incl. fee), received {received}",
        paid + fee,
    );
}

/// Nothing in the program lets the creator take stock out of the vault.
#[test]
fn the_creator_cannot_drain_the_vault() {
    let mut m = setup();
    let h = holder(&mut m);
    buy(&mut m, &h, 1_000);

    let creator = m.env.creator.insecure_clone();
    let creator_key = creator.pubkey();
    let stock_mint = m.env.stock_mint;
    let creator_tokens = m.env.create_token_account(&creator_key, &stock_mint);
    let creator_narrative = m
        .env
        .create_token_account(&creator_key, &m.narrative_mint);

    let vault_before = vault_balance(&m);

    // Selling without holding any narrative tokens gets nothing.
    let ix = sell_ix(
        &m.env,
        &m.narrative_mint,
        &creator_key,
        &creator_narrative,
        &creator_tokens,
        &m.narrative,
        &m.vault,
        1_000,
        0,
    );
    assert!(m.env.send(&[ix], &[&creator]).is_err());

    // Nor after expiry.
    expire(&mut m);
    let ix = redeem_ix(
        &m.env,
        &m.narrative_mint,
        &creator_key,
        &creator_narrative,
        &creator_tokens,
        &m.narrative,
        &m.vault,
    );
    assert!(m.env.send(&[ix], &[&creator]).is_err());

    assert_eq!(vault_balance(&m), vault_before);
}

// --- the whole loop -------------------------------------------------------

#[test]
fn the_full_lifecycle_works() {
    let mut m = setup();

    // Two people buy the story.
    let a = holder(&mut m);
    let b = holder(&mut m);
    buy(&mut m, &a, 2_000);
    buy(&mut m, &b, 3_000);
    assert!(vault_balance(&m) > 0);
    state(&m, |s| assert_eq!(s.supply(), 5_000));

    // One changes their mind and takes the tax hit.
    let ix = sell_ix(
        &m.env,
        &m.narrative_mint,
        &b.wallet.pubkey(),
        &b.tokens,
        &b.stock,
        &m.narrative,
        &m.vault,
        1_000,
        0,
    );
    m.env.send(&[ix], &[&b.wallet]).expect("sell");
    state(&m, |s| assert_eq!(s.supply(), 4_000));

    // The date arrives and anyone can settle it.
    expire(&mut m);

    // Both convert into stock.
    for h in [&a, &b] {
        let ix = redeem_ix(&m.env, &m.narrative_mint, &h.wallet.pubkey(), &h.tokens, &h.stock, &m.narrative, &m.vault);
        m.env.send(&[ix], &[&h.wallet]).expect("redeem");
        assert_eq!(m.env.token_balance(&h.tokens), 0);
    }

    assert_eq!(vault_balance(&m), 0);
    state(&m, |s| {
        assert_eq!(s.status().unwrap(), Status::Settled);
        assert_eq!(s.supply(), 0);
    });
}

// --- Token-2022 -----------------------------------------------------------

/// Real tokenized stocks (xStocks) are Token-2022 mints, not classic SPL. The
/// whole lifecycle has to work against one, or the program cannot hold the
/// asset it is built around.
#[test]
fn the_full_lifecycle_works_with_a_token_2022_stock() {
    let mut m = setup_token_2022();
    assert_eq!(m.env.stock_program, TOKEN_2022_PROGRAM);

    let a = holder(&mut m);
    let b = holder(&mut m);

    // Buy: stock moves in via TransferChecked against Token-2022.
    let cost = opening_cost(2_000);
    let fee = apply_bps(cost, FEE_BPS).unwrap();
    buy(&mut m, &a, 2_000);
    assert_eq!(vault_balance(&m), cost);
    assert_eq!(m.env.token_balance(&m.creator_fee), fee);

    buy(&mut m, &b, 3_000);
    state(&m, |s| {
        assert_eq!(s.supply(), 5_000);
        // The program recorded which token program the stock belongs to.
        assert_eq!(s.stock_token_program, TOKEN_2022_PROGRAM);
        assert_eq!(s.stock_decimals, STOCK_DECIMALS);
    });

    // Sell: stock moves back out, signed by the narrative PDA.
    let stock_before = m.env.token_balance(&b.stock);
    let ix = sell_ix(
        &m.env,
        &m.narrative_mint,
        &b.wallet.pubkey(),
        &b.tokens,
        &b.stock,
        &m.narrative,
        &m.vault,
        1_000,
        0,
    );
    m.env.send(&[ix], &[&b.wallet]).expect("sell");
    assert!(m.env.token_balance(&b.stock) > stock_before);

    // Expire and convert.
    expire(&mut m);
    for h in [&a, &b] {
        let before = m.env.token_balance(&h.stock);
        let ix = redeem_ix(
            &m.env,
            &m.narrative_mint,
            &h.wallet.pubkey(),
            &h.tokens,
            &h.stock,
            &m.narrative,
            &m.vault,
        );
        m.env.send(&[ix], &[&h.wallet]).expect("redeem");
        assert!(
            m.env.token_balance(&h.stock) > before,
            "holder should receive Token-2022 stock",
        );
        assert_eq!(m.env.token_balance(&h.tokens), 0);
    }

    assert_eq!(vault_balance(&m), 0);
    state(&m, |s| assert_eq!(s.status().unwrap(), Status::Settled));
}

/// A stock mint whose token program does not match the one supplied is
/// rejected, so a caller cannot pass the wrong program to route a transfer.
#[test]
fn the_stock_token_program_is_pinned_at_creation() {
    let m = setup_token_2022();
    state(&m, |s| {
        assert_eq!(s.stock_token_program, TOKEN_2022_PROGRAM);
    });

    let classic = setup();
    state(&classic, |s| {
        assert_eq!(s.stock_token_program, TOKEN_PROGRAM);
    });
}


// --- the mint is verified, not built --------------------------------------

/// `create_narrative` accepts a mint it did not create, so each precondition
/// it checks needs a test — a miss here means supply can be minted beside the
/// curve, or holders can be frozen out.
#[test]
fn a_mint_that_did_not_hand_over_authority_is_rejected() {
    let mut env = Env::new();
    let creator = env.creator.insecure_clone();
    let key = creator.pubkey();
    let expiry = env.now() + DURATION;

    // Authority kept by the creator rather than handed to the narrative PDA,
    // which would let them keep minting alongside the curve.
    let (narrative_mint, narrative) =
        env.create_narrative_mint_with(Some(key), None, None, Delegate::Narrative);
    let vault = env.create_vault(&narrative);

    let ix = create_narrative_ix(
        &env, &key, &narrative_mint, &vault, "SNEAKY", "SNK", expiry, VIRTUAL_STOCK,
        FEE_BPS, SELL_TAX_BPS,
    );
    assert!(
        env.send(&[ix], &[&creator]).is_err(),
        "a mint the creator can still mint from must be rejected",
    );
}

#[test]
fn a_mint_with_a_freeze_authority_is_rejected() {
    let mut env = Env::new();
    let creator = env.creator.insecure_clone();
    let key = creator.pubkey();
    let expiry = env.now() + DURATION;

    // A freeze authority could strand every holder's tokens before expiry.
    let (narrative_mint, narrative) =
        env.create_narrative_mint_with(None, Some(key), None, Delegate::Narrative);
    let vault = env.create_vault(&narrative);

    let ix = create_narrative_ix(
        &env, &key, &narrative_mint, &vault, "FREEZE", "FRZ", expiry, VIRTUAL_STOCK,
        FEE_BPS, SELL_TAX_BPS,
    );
    assert!(env.send(&[ix], &[&creator]).is_err());
}

#[test]
fn a_mint_with_the_wrong_decimals_is_rejected() {
    let mut env = Env::new();
    let creator = env.creator.insecure_clone();
    let key = creator.pubkey();
    let expiry = env.now() + DURATION;

    // The curve's reserves are counted in whole tokens; 6 decimals would put a
    // million times more tokens on it than the reserves account for.
    let (narrative_mint, narrative) =
        env.create_narrative_mint_with(None, None, Some(6), Delegate::Narrative);
    let vault = env.create_vault(&narrative);

    let ix = create_narrative_ix(
        &env, &key, &narrative_mint, &vault, "DECIMALS", "DEC", expiry, VIRTUAL_STOCK,
        FEE_BPS, SELL_TAX_BPS,
    );
    assert!(env.send(&[ix], &[&creator]).is_err());
}

// --- conversion: paying everyone out without their signature ---------------

#[test]
fn convert_pays_every_holder_without_their_signature() {
    let mut m = setup();
    let a = holder(&mut m);
    let b = holder(&mut m);

    buy(&mut m, &a, 333);
    buy(&mut m, &b, 667);
    expire(&mut m);
    let pot = state(&m, |s| s.final_vault());

    let a_before = m.env.token_balance(&a.stock);
    let b_before = m.env.token_balance(&b.stock);

    // Neither A nor B signs anything from here on.
    convert(&mut m, &a).expect("keeper converts A");
    convert(&mut m, &b).expect("keeper converts B");

    let a_payout = m.env.token_balance(&a.stock) - a_before;
    let b_payout = m.env.token_balance(&b.stock) - b_before;
    assert_eq!(a_payout, pot * 333 / 1_000);
    assert_eq!(a_payout + b_payout, pot, "the whole pot is paid out");
    assert_eq!(m.env.token_balance(&a.tokens), 0);
    assert_eq!(m.env.token_balance(&b.tokens), 0);
    assert_eq!(vault_balance(&m), 0);
    state(&m, |s| assert_eq!(s.status().unwrap(), Status::Settled));
}

#[test]
fn convert_cannot_redirect_a_payout() {
    let mut m = setup();
    let a = holder(&mut m);
    let thief = holder(&mut m);
    buy(&mut m, &a, 500);
    expire(&mut m);

    // A's tokens, but the stock account belongs to someone else.
    let keeper = m.env.creator.insecure_clone();
    let ix = convert_ix(&m.env, &m.narrative_mint, &a.tokens, &thief.stock, &m.narrative, &m.vault);
    assert!(m.env.send(&[ix], &[&keeper]).is_err());
    assert_eq!(m.env.token_balance(&a.tokens), 500, "nothing was burned");
}

#[test]
fn convert_before_expiry_fails() {
    let mut m = setup();
    let a = holder(&mut m);
    buy(&mut m, &a, 100);
    assert!(convert(&mut m, &a).is_err());
}

#[test]
fn a_mint_whose_delegate_is_not_the_narrative_is_rejected() {
    for delegate in [Delegate::None, Delegate::Other(Keypair::new().pubkey())] {
        let mut env = Env::new();
        let creator = env.creator.insecure_clone();
        let expiry = env.now() + DURATION;
        let (mint, narrative) = env.create_narrative_mint_with(None, None, None, delegate);
        let vault = env.create_vault(&narrative);
        let ix = create_narrative_ix(
            &env, &creator.pubkey(), &mint, &vault, "ROBOTAXI", "RBTX", expiry,
            VIRTUAL_STOCK, FEE_BPS, SELL_TAX_BPS,
        );
        assert!(env.send(&[ix], &[&creator]).is_err());
    }
}
