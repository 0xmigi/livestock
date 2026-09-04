//! LiteSVM harness: the program loaded, a mock stock mint, and hand-rolled
//! instruction builders.
//!
//! SPL Token instructions are built by hand rather than pulled from the
//! `spl-token` crate, which sits on an older `solana-program` line and would
//! drag a second, incompatible `Address` type into the test build.

#![allow(dead_code)]

use {
    litesvm::{types::TransactionResult, LiteSVM},
    narrative_markets::state::{MINT_SEED, NARRATIVE_SEED, VAULT_SEED},
    solana_address::Address,
    solana_clock::Clock,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_signer::Signer,
    solana_transaction::Transaction,
};

pub const TOKEN_PROGRAM: Address =
    Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const SYSTEM_PROGRAM: Address = Address::from_str_const("11111111111111111111111111111111");

pub const MINT_LEN: usize = 82;
pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const SOL: u64 = 1_000_000_000;

/// xStocks carry 8 decimals.
pub const STOCK_DECIMALS: u8 = 8;

/// Defaults sized for a ~$250 stock: first token ≈ $0.10.
pub const BASE_PRICE: u64 = 40_000;
pub const SLOPE: u64 = 4;
pub const FEE_BPS: u16 = 100; // 1%
pub const SELL_TAX_BPS: u16 = 1_000; // 10%

pub const HOUR: i64 = 3_600;
pub const DURATION: i64 = 24 * HOUR;

pub struct Env {
    pub svm: LiteSVM,
    pub creator: Keypair,
    pub stock_mint: Address,
}

impl Env {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(narrative_markets::ID, program_binary())
            .expect("load narrative_markets.so");

        let creator = Keypair::new();
        svm.airdrop(&creator.pubkey(), 1_000 * SOL).unwrap();

        let mut env = Self {
            svm,
            creator,
            stock_mint: Address::default(),
        };
        env.stock_mint = env.create_mint(STOCK_DECIMALS);
        env
    }

    // --- addresses --------------------------------------------------------

    pub fn narrative(&self, creator: &Address, name: &str) -> Address {
        Address::find_program_address(
            &[
                NARRATIVE_SEED,
                self.stock_mint.as_ref(),
                creator.as_ref(),
                name.as_bytes(),
            ],
            &narrative_markets::ID,
        )
        .0
    }

    pub fn narrative_mint(&self, narrative: &Address) -> Address {
        Address::find_program_address(&[MINT_SEED, narrative.as_ref()], &narrative_markets::ID).0
    }

    pub fn vault(&self, narrative: &Address) -> Address {
        Address::find_program_address(&[VAULT_SEED, narrative.as_ref()], &narrative_markets::ID).0
    }

    // --- plumbing ---------------------------------------------------------

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TransactionResult {
        let payer = signers[0].pubkey();
        let msg = Message::new(ixs, Some(&payer));
        let tx = Transaction::new(signers, msg, self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    pub fn new_wallet(&mut self, lamports: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), lamports).unwrap();
        kp
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn advance_clock(&mut self, seconds: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar(&clock);
    }

    // --- token helpers ----------------------------------------------------

    pub fn create_mint(&mut self, decimals: u8) -> Address {
        let mint = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(MINT_LEN);
        let creator_key = self.creator.pubkey();

        let create = solana_system_interface::instruction::create_account(
            &creator_key,
            &mint.pubkey(),
            rent,
            MINT_LEN as u64,
            &TOKEN_PROGRAM,
        );
        let mut data = vec![20u8, decimals];
        data.extend_from_slice(creator_key.as_ref());
        data.push(0); // no freeze authority
        let init = Instruction {
            program_id: TOKEN_PROGRAM,
            accounts: vec![AccountMeta::new(mint.pubkey(), false)],
            data,
        };

        let creator = self.creator.insecure_clone();
        self.send(&[create, init], &[&creator, &mint])
            .expect("create mint");
        mint.pubkey()
    }

    pub fn create_token_account(&mut self, owner: &Address, mint: &Address) -> Address {
        let account = Keypair::new();
        let rent = self
            .svm
            .minimum_balance_for_rent_exemption(TOKEN_ACCOUNT_LEN);
        let creator_key = self.creator.pubkey();

        let create = solana_system_interface::instruction::create_account(
            &creator_key,
            &account.pubkey(),
            rent,
            TOKEN_ACCOUNT_LEN as u64,
            &TOKEN_PROGRAM,
        );
        let mut data = vec![18u8]; // InitializeAccount3
        data.extend_from_slice(owner.as_ref());
        let init = Instruction {
            program_id: TOKEN_PROGRAM,
            accounts: vec![
                AccountMeta::new(account.pubkey(), false),
                AccountMeta::new_readonly(*mint, false),
            ],
            data,
        };

        let creator = self.creator.insecure_clone();
        self.send(&[create, init], &[&creator, &account])
            .expect("create token account");
        account.pubkey()
    }

    pub fn mint_stock_to(&mut self, destination: &Address, amount: u64) {
        let mut data = vec![7u8]; // MintTo
        data.extend_from_slice(&amount.to_le_bytes());
        let creator_key = self.creator.pubkey();
        let ix = Instruction {
            program_id: TOKEN_PROGRAM,
            accounts: vec![
                AccountMeta::new(self.stock_mint, false),
                AccountMeta::new(*destination, false),
                AccountMeta::new_readonly(creator_key, true),
            ],
            data,
        };
        let creator = self.creator.insecure_clone();
        self.send(&[ix], &[&creator]).expect("mint stock");
    }

    pub fn token_balance(&self, account: &Address) -> u64 {
        let acct = self.svm.get_account(account).expect("token account exists");
        u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
    }

    pub fn mint_has_authority(&self, mint: &Address) -> bool {
        let acct = self.svm.get_account(mint).expect("mint exists");
        u32::from_le_bytes(acct.data[0..4].try_into().unwrap()) == 1
    }
}

// --- program instruction builders ----------------------------------------

#[allow(clippy::too_many_arguments)]
pub fn create_narrative_ix(
    env: &Env,
    creator: &Address,
    name: &str,
    symbol: &str,
    expiry_ts: i64,
    base_price: u64,
    slope: u64,
    fee_bps: u16,
    sell_tax_bps: u16,
) -> Instruction {
    let narrative = env.narrative(creator, name);
    let mut data = vec![0u8];
    data.extend_from_slice(&expiry_ts.to_le_bytes());
    data.extend_from_slice(&base_price.to_le_bytes());
    data.extend_from_slice(&slope.to_le_bytes());
    data.extend_from_slice(&fee_bps.to_le_bytes());
    data.extend_from_slice(&sell_tax_bps.to_le_bytes());
    data.push(name.len() as u8);
    data.extend_from_slice(name.as_bytes());
    data.extend_from_slice(symbol.as_bytes());

    Instruction {
        program_id: narrative_markets::ID,
        accounts: vec![
            AccountMeta::new(*creator, true),
            AccountMeta::new(narrative, false),
            AccountMeta::new_readonly(env.stock_mint, false),
            AccountMeta::new(env.narrative_mint(&narrative), false),
            AccountMeta::new(env.vault(&narrative), false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data,
    }
}

pub fn buy_ix(
    env: &Env,
    buyer: &Address,
    buyer_tokens: &Address,
    buyer_stock: &Address,
    creator_fee: &Address,
    narrative: &Address,
    tokens_out: u64,
    max_stock_in: u64,
) -> Instruction {
    let mut data = vec![1u8];
    data.extend_from_slice(&tokens_out.to_le_bytes());
    data.extend_from_slice(&max_stock_in.to_le_bytes());

    Instruction {
        program_id: narrative_markets::ID,
        accounts: vec![
            AccountMeta::new_readonly(*buyer, true),
            AccountMeta::new(*narrative, false),
            AccountMeta::new(env.narrative_mint(narrative), false),
            AccountMeta::new(*buyer_tokens, false),
            AccountMeta::new(*buyer_stock, false),
            AccountMeta::new(env.vault(narrative), false),
            AccountMeta::new(*creator_fee, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data,
    }
}

pub fn sell_ix(
    env: &Env,
    seller: &Address,
    seller_tokens: &Address,
    seller_stock: &Address,
    narrative: &Address,
    tokens_in: u64,
    min_stock_out: u64,
) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&tokens_in.to_le_bytes());
    data.extend_from_slice(&min_stock_out.to_le_bytes());

    Instruction {
        program_id: narrative_markets::ID,
        accounts: vec![
            AccountMeta::new_readonly(*seller, true),
            AccountMeta::new(*narrative, false),
            AccountMeta::new(env.narrative_mint(narrative), false),
            AccountMeta::new(*seller_tokens, false),
            AccountMeta::new(*seller_stock, false),
            AccountMeta::new(env.vault(narrative), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data,
    }
}

pub fn expire_ix(env: &Env, narrative: &Address) -> Instruction {
    Instruction {
        program_id: narrative_markets::ID,
        accounts: vec![
            AccountMeta::new(*narrative, false),
            AccountMeta::new(env.narrative_mint(narrative), false),
            AccountMeta::new_readonly(env.vault(narrative), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data: vec![3u8],
    }
}

pub fn redeem_ix(
    env: &Env,
    holder: &Address,
    holder_tokens: &Address,
    holder_stock: &Address,
    narrative: &Address,
) -> Instruction {
    Instruction {
        program_id: narrative_markets::ID,
        accounts: vec![
            AccountMeta::new_readonly(*holder, true),
            AccountMeta::new(*narrative, false),
            AccountMeta::new(env.narrative_mint(narrative), false),
            AccountMeta::new(*holder_tokens, false),
            AccountMeta::new(*holder_stock, false),
            AccountMeta::new(env.vault(narrative), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data: vec![4u8],
    }
}

fn program_binary() -> &'static str {
    concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/narrative_markets.so"
    )
}
