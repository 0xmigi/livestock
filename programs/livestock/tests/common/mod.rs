//! LiteSVM harness: the program loaded, a mock stock mint, and hand-rolled
//! instruction builders.
//!
//! SPL Token instructions are built by hand rather than pulled from the
//! `spl-token` crate, which sits on an older `solana-program` line and would
//! drag a second, incompatible `Address` type into the test build.

#![allow(dead_code)]

use {
    litesvm::{types::TransactionResult, LiteSVM},
    livestock::state::{NARRATIVE_SEED, NARRATIVE_TOKEN_PROGRAM},
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
pub const TOKEN_2022_PROGRAM: Address =
    Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const SYSTEM_PROGRAM: Address = Address::from_str_const("11111111111111111111111111111111");
pub const ASSOCIATED_TOKEN_PROGRAM: Address =
    Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

pub const MINT_LEN: usize = 82;
pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const SOL: u64 = 1_000_000_000;

/// xStocks carry 8 decimals.
pub const STOCK_DECIMALS: u8 = 8;

/// The curve's opening virtual stock reserve: 30 SOL at $150 is $4,500,
/// which in a $250 stock with 8 decimals is 18 shares.
pub const VIRTUAL_STOCK: u64 = 1_800_000_000;
pub const FEE_BPS: u16 = 100; // 1%
pub const SELL_TAX_BPS: u16 = 1_000; // 10%

pub const HOUR: i64 = 3_600;
pub const DURATION: i64 = 24 * HOUR;

/// Who a narrative mint names as permanent delegate.
#[derive(Clone, Copy)]
pub enum Delegate {
    /// The narrative PDA — what the program requires.
    Narrative,
    /// Nobody: an old-style mint.
    None,
    /// Some other key: a mint that could seize holders' tokens.
    Other(Address),
}

/// Base mint, padding to the token account length, the account-type byte,
/// and one 32-byte extension with its 4-byte TLV header.
pub const MINT_WITH_DELEGATE_LEN: usize = 165 + 1 + 4 + 32;
/// The same with a second 32-byte extension: a mint close authority.
pub const MINT_WITH_DELEGATE_AND_CLOSE_LEN: usize = MINT_WITH_DELEGATE_LEN + 4 + 32;

pub struct Env {
    pub svm: LiteSVM,
    pub creator: Keypair,
    pub stock_mint: Address,
    /// Which token program the stock belongs to. Real tokenized stocks are
    /// Token-2022, so the suite exercises both.
    pub stock_program: Address,
}

impl Env {
    /// A vault with a classic SPL stock mint.
    pub fn new() -> Self {
        Self::with_stock_program(TOKEN_PROGRAM)
    }

    /// A vault whose stock is a Token-2022 mint, as real xStocks are.
    pub fn new_token_2022() -> Self {
        Self::with_stock_program(TOKEN_2022_PROGRAM)
    }

    pub fn with_stock_program(stock_program: Address) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(livestock::ID, program_binary())
            .expect("load livestock.so");

        let creator = Keypair::new();
        svm.airdrop(&creator.pubkey(), 1_000 * SOL).unwrap();

        let mut env = Self {
            svm,
            creator,
            stock_mint: Address::default(),
            stock_program,
        };
        env.stock_mint = env.create_mint_with(STOCK_DECIMALS, stock_program);
        env
    }

    // --- addresses --------------------------------------------------------

    /// The narrative PDA for a mint — one fixed seed, since the mint is a
    /// plain keypair rather than a derived address.
    pub fn narrative_for(mint: &Address) -> Address {
        Address::find_program_address(&[NARRATIVE_SEED, mint.as_ref()], &livestock::ID).0
    }

    /// Creates a Token-2022 narrative mint with zero decimals whose mint
    /// authority is already its own narrative PDA, and no freeze authority —
    /// the shape `create_narrative` insists on.
    ///
    /// The real client also initialises the metadata extensions here; the
    /// program does not inspect those, so tests use a bare mint.
    pub fn create_narrative_mint(&mut self) -> (Address, Address) {
        self.create_narrative_mint_with(None, None, None, Delegate::Narrative)
    }

    /// The same, but lets a test hand over a deliberately wrong mint:
    /// a different mint authority, a freeze authority, or pre-existing supply.
    pub fn create_narrative_mint_with(
        &mut self,
        authority_override: Option<Address>,
        freeze_authority: Option<Address>,
        decimals_override: Option<u8>,
        delegate: Delegate,
    ) -> (Address, Address) {
        let mint = Keypair::new();
        let narrative = Self::narrative_for(&mint.pubkey());
        let authority = authority_override.unwrap_or(narrative);
        let decimals = decimals_override.unwrap_or(0);

        let delegate = match delegate {
            Delegate::Narrative => Some(narrative),
            Delegate::Other(key) => Some(key),
            Delegate::None => None,
        };
        // A mint with the extension is padded to the token account length,
        // then carries one type byte and the TLV entry (type, length, key).
        let space = if delegate.is_some() { MINT_WITH_DELEGATE_LEN } else { MINT_LEN };
        let rent = self.svm.minimum_balance_for_rent_exemption(space);
        let creator_key = self.creator.pubkey();

        let create = solana_system_interface::instruction::create_account(
            &creator_key,
            &mint.pubkey(),
            rent,
            space as u64,
            &NARRATIVE_TOKEN_PROGRAM,
        );
        let mut ixs = vec![create];
        if let Some(delegate) = delegate {
            let mut data = vec![35u8]; // InitializePermanentDelegate
            data.extend_from_slice(delegate.as_ref());
            ixs.push(Instruction {
                program_id: NARRATIVE_TOKEN_PROGRAM,
                accounts: vec![AccountMeta::new(mint.pubkey(), false)],
                data,
            });
        }
        let mut data = vec![20u8, decimals]; // InitializeMint2
        data.extend_from_slice(authority.as_ref());
        match freeze_authority {
            Some(f) => {
                data.push(1);
                data.extend_from_slice(f.as_ref());
            }
            None => data.push(0),
        }
        ixs.push(Instruction {
            program_id: NARRATIVE_TOKEN_PROGRAM,
            accounts: vec![AccountMeta::new(mint.pubkey(), false)],
            data,
        });

        let creator = self.creator.insecure_clone();
        self.send(&ixs, &[&creator, &mint])
            .expect("create narrative mint");
        (mint.pubkey(), narrative)
    }

    /// The vault: the narrative PDA's associated token account for the
    /// stock, which is the only vault `create_narrative` accepts.
    pub fn create_vault(&mut self, narrative: &Address) -> Address {
        let mint = self.stock_mint;
        let program = self.stock_program;
        let ata = Address::find_program_address(
            &[narrative.as_ref(), program.as_ref(), mint.as_ref()],
            &ASSOCIATED_TOKEN_PROGRAM,
        )
        .0;
        let creator = self.creator.insecure_clone();
        let ix = Instruction {
            program_id: ASSOCIATED_TOKEN_PROGRAM,
            accounts: vec![
                AccountMeta::new(creator.pubkey(), true),
                AccountMeta::new(ata, false),
                AccountMeta::new_readonly(*narrative, false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
                AccountMeta::new_readonly(program, false),
            ],
            data: vec![1], // CreateIdempotent
        };
        self.send(&[ix], &[&creator]).expect("create vault ata");
        ata
    }

    /// A vault the program must refuse: a plain keypair token account owned by
    /// the narrative PDA. Its creator keeps the close authority, so it could
    /// be closed while empty and re-created under another owner.
    pub fn create_keypair_vault(&mut self, narrative: &Address) -> Address {
        let mint = self.stock_mint;
        let program = self.stock_program;
        self.create_token_account_with(narrative, &mint, program)
    }

    /// A narrative mint that is right in every way the program checked before
    /// v0.2.1, plus a mint close authority held by the creator: enough to
    /// delete the mint at zero supply and put a different one at its address.
    pub fn create_narrative_mint_with_close_authority(&mut self) -> (Address, Address) {
        let mint = Keypair::new();
        let narrative = Self::narrative_for(&mint.pubkey());
        let space = MINT_WITH_DELEGATE_AND_CLOSE_LEN;
        let rent = self.svm.minimum_balance_for_rent_exemption(space);
        let creator_key = self.creator.pubkey();

        let create = solana_system_interface::instruction::create_account(
            &creator_key,
            &mint.pubkey(),
            rent,
            space as u64,
            &NARRATIVE_TOKEN_PROGRAM,
        );
        let mut close = vec![25u8, 1]; // InitializeMintCloseAuthority, Some(creator)
        close.extend_from_slice(creator_key.as_ref());
        let mut delegate = vec![35u8]; // InitializePermanentDelegate
        delegate.extend_from_slice(narrative.as_ref());
        let mut init = vec![20u8, 0]; // InitializeMint2, 0 decimals
        init.extend_from_slice(narrative.as_ref());
        init.push(0); // no freeze authority
        let ixs: Vec<Instruction> = [close, delegate, init]
            .into_iter()
            .map(|data| Instruction {
                program_id: NARRATIVE_TOKEN_PROGRAM,
                accounts: vec![AccountMeta::new(mint.pubkey(), false)],
                data,
            })
            .collect();
        let creator = self.creator.insecure_clone();
        self.send(&[create, ixs[0].clone(), ixs[1].clone(), ixs[2].clone()], &[&creator, &mint])
            .expect("create narrative mint with close authority");
        (mint.pubkey(), narrative)
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
        self.create_mint_with(decimals, TOKEN_PROGRAM)
    }

    pub fn create_mint_with(&mut self, decimals: u8, program: Address) -> Address {
        let mint = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(MINT_LEN);
        let creator_key = self.creator.pubkey();

        let create = solana_system_interface::instruction::create_account(
            &creator_key,
            &mint.pubkey(),
            rent,
            MINT_LEN as u64,
            &program,
        );
        let mut data = vec![20u8, decimals];
        data.extend_from_slice(creator_key.as_ref());
        data.push(0); // no freeze authority
        let init = Instruction {
            program_id: program,
            accounts: vec![AccountMeta::new(mint.pubkey(), false)],
            data,
        };

        let creator = self.creator.insecure_clone();
        self.send(&[create, init], &[&creator, &mint])
            .expect("create mint");
        mint.pubkey()
    }

    pub fn create_token_account(&mut self, owner: &Address, mint: &Address) -> Address {
        // Stock accounts follow the stock's program; narrative accounts are
        // always Token-2022.
        let program = if *mint == self.stock_mint {
            self.stock_program
        } else {
            NARRATIVE_TOKEN_PROGRAM
        };
        self.create_token_account_with(owner, mint, program)
    }

    pub fn create_token_account_with(
        &mut self,
        owner: &Address,
        mint: &Address,
        program: Address,
    ) -> Address {
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
            &program,
        );
        let mut data = vec![18u8]; // InitializeAccount3
        data.extend_from_slice(owner.as_ref());
        let init = Instruction {
            program_id: program,
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
            program_id: self.stock_program,
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
    narrative_mint: &Address,
    vault: &Address,
    name: &str,
    symbol: &str,
    expiry_ts: i64,
    virtual_stock: u64,
    fee_bps: u16,
    sell_tax_bps: u16,
) -> Instruction {
    let narrative = Env::narrative_for(narrative_mint);
    let mut data = vec![0u8];
    data.extend_from_slice(&expiry_ts.to_le_bytes());
    data.extend_from_slice(&virtual_stock.to_le_bytes());
    data.extend_from_slice(&fee_bps.to_le_bytes());
    data.extend_from_slice(&sell_tax_bps.to_le_bytes());
    data.push(name.len() as u8);
    data.extend_from_slice(name.as_bytes());
    data.extend_from_slice(symbol.as_bytes());

    Instruction {
        program_id: livestock::ID,
        accounts: vec![
            AccountMeta::new(*creator, true),
            AccountMeta::new(narrative, false),
            AccountMeta::new_readonly(env.stock_mint, false),
            AccountMeta::new_readonly(*narrative_mint, false),
            AccountMeta::new_readonly(*vault, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(env.stock_program, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn buy_ix(
    env: &Env,
    narrative_mint: &Address,
    buyer: &Address,
    buyer_tokens: &Address,
    buyer_stock: &Address,
    creator_fee: &Address,
    treasury_fee: &Address,
    narrative: &Address,
    vault: &Address,
    tokens_out: u64,
    max_stock_in: u64,
) -> Instruction {
    let mut data = vec![1u8];
    data.extend_from_slice(&tokens_out.to_le_bytes());
    data.extend_from_slice(&max_stock_in.to_le_bytes());

    Instruction {
        program_id: livestock::ID,
        accounts: vec![
            AccountMeta::new_readonly(*buyer, true),
            AccountMeta::new(*narrative, false),
            AccountMeta::new(*narrative_mint, false),
            AccountMeta::new(*buyer_tokens, false),
            AccountMeta::new(*buyer_stock, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new(*creator_fee, false),
            AccountMeta::new(*treasury_fee, false),
            AccountMeta::new_readonly(env.stock_mint, false),
            AccountMeta::new_readonly(NARRATIVE_TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(env.stock_program, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn sell_ix(
    env: &Env,
    narrative_mint: &Address,
    seller: &Address,
    seller_tokens: &Address,
    seller_stock: &Address,
    narrative: &Address,
    vault: &Address,
    tokens_in: u64,
    min_stock_out: u64,
) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&tokens_in.to_le_bytes());
    data.extend_from_slice(&min_stock_out.to_le_bytes());

    Instruction {
        program_id: livestock::ID,
        accounts: vec![
            AccountMeta::new_readonly(*seller, true),
            AccountMeta::new(*narrative, false),
            AccountMeta::new(*narrative_mint, false),
            AccountMeta::new(*seller_tokens, false),
            AccountMeta::new(*seller_stock, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(env.stock_mint, false),
            AccountMeta::new_readonly(NARRATIVE_TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(env.stock_program, false),
        ],
        data,
    }
}

pub fn expire_ix(
    env: &Env,
    narrative_mint: &Address,
    narrative: &Address,
    vault: &Address,
    treasury_fee: &Address,
) -> Instruction {
    Instruction {
        program_id: livestock::ID,
        accounts: vec![
            AccountMeta::new(*narrative, false),
            AccountMeta::new(*narrative_mint, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(env.stock_mint, false),
            AccountMeta::new(*treasury_fee, false),
            AccountMeta::new_readonly(NARRATIVE_TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(env.stock_program, false),
        ],
        data: vec![3u8],
    }
}

/// Permissionless: no signer among the accounts, the fee payer is whoever
/// sends the transaction.
pub fn convert_ix(
    env: &Env,
    narrative_mint: &Address,
    holder_tokens: &Address,
    holder_stock: &Address,
    narrative: &Address,
    vault: &Address,
) -> Instruction {
    Instruction {
        program_id: livestock::ID,
        accounts: vec![
            AccountMeta::new(*narrative, false),
            AccountMeta::new(*narrative_mint, false),
            AccountMeta::new(*holder_tokens, false),
            AccountMeta::new(*holder_stock, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(env.stock_mint, false),
            AccountMeta::new_readonly(NARRATIVE_TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(env.stock_program, false),
        ],
        data: vec![5u8],
    }
}

pub fn redeem_ix(
    env: &Env,
    narrative_mint: &Address,
    holder: &Address,
    holder_tokens: &Address,
    holder_stock: &Address,
    narrative: &Address,
    vault: &Address,
) -> Instruction {
    Instruction {
        program_id: livestock::ID,
        accounts: vec![
            AccountMeta::new_readonly(*holder, true),
            AccountMeta::new(*narrative, false),
            AccountMeta::new(*narrative_mint, false),
            AccountMeta::new(*holder_tokens, false),
            AccountMeta::new(*holder_stock, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(env.stock_mint, false),
            AccountMeta::new_readonly(NARRATIVE_TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(env.stock_program, false),
        ],
        data: vec![4u8],
    }
}

fn program_binary() -> &'static str {
    concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/livestock.so"
    )
}
