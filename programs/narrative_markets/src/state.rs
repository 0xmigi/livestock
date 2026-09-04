//! The `Narrative` account.
//!
//! Laid out as `[discriminator: u8 | version: u8 | payload]`.
//!
//! The payload is `#[repr(C)]` with **alignment 1** — every multi-byte integer
//! is stored as a little-endian byte array with accessors. That is what makes
//! casting `&data[2..]` to `&Self` sound: the payload starts at an odd offset,
//! so a struct containing a native `u64` would produce an unaligned reference.
//! `Address` is `#[repr(transparent)]` over `[u8; 32]`, so it is safe here.
//! Do not "simplify" these back to native integer types.

use {
    crate::error::MarketError,
    pinocchio::{error::ProgramError, Address},
};

/// PDA seed prefix for a narrative. Seeded on the mint, which is a plain
/// keypair — so the narrative account is `["narrative", mint]` and nothing
/// else. Seeding on a variable-length name meant dragging the name bytes
/// through every signer-seed array in the program.
pub const NARRATIVE_SEED: &[u8] = b"narrative";
/// SPL Token program.
pub const TOKEN_PROGRAM: Address =
    Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// SPL Token-2022 program. Real tokenized stocks (xStocks) live here.
pub const TOKEN_2022_PROGRAM: Address =
    Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;

/// Narrative mints carry **0 decimals**: one token is one integer unit.
///
/// Launchpad convention is 6, and this deviates on purpose. The curve is
/// linear in stock base units, and over a 6-decimal supply the slope would be
/// a fraction far below 1 — it floors to zero in integer arithmetic. Scaling
/// it back up reintroduces a division whose flooring can make the marginal
/// price equal the average, and "marginal strictly exceeds average" is the
/// invariant that makes buying-and-redeeming always a loss. Whole units keep
/// that exact.
pub const NARRATIVE_DECIMALS: u8 = 0;

/// Narrative mints are Token-2022, matching what launchpads now issue, and
/// carry their name, symbol and URI in the mint's own `TokenMetadata`
/// extension rather than a separate Metaplex account.
pub const NARRATIVE_TOKEN_PROGRAM: Address = TOKEN_2022_PROGRAM;

/// Shortest permitted life of a narrative.
pub const MIN_DURATION_SECS: i64 = 60 * 60;
/// Longest permitted life of a narrative.
pub const MAX_DURATION_SECS: i64 = 90 * 24 * 60 * 60;

/// Ceiling on the creator's buy fee (10%).
pub const MAX_FEE_BPS: u16 = 1_000;
/// Ceiling on the sell tax (20%).
pub const MAX_SELL_TAX_BPS: u16 = 2_000;

const DISCRIMINATOR: u8 = 1;
/// Bumped when the payload layout changes. The account size did not change
/// between v1 and v2, so without checking this an old account would decode
/// silently into the wrong fields rather than being rejected.
const VERSION: u8 = 2;
const HEADER: usize = 2;

/// Lifecycle. There is no path back to `Live`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Status {
    /// Curve trading is open until `expiry_ts`.
    Live = 0,
    /// Trading is over; `redeem` is the only action.
    Expired = 1,
    /// Every token has been redeemed.
    Settled = 2,
}

impl TryFrom<u8> for Status {
    type Error = ProgramError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Live),
            1 => Ok(Self::Expired),
            2 => Ok(Self::Settled),
            _ => Err(ProgramError::InvalidAccountData),
        }
    }
}

/// One narrative token: a story about a company, expiring into its stock.
#[repr(C)]
pub struct Narrative {
    pub creator: Address,
    /// The tokenized stock this narrative expires into.
    pub stock_mint: Address,
    pub narrative_mint: Address,
    /// Token account holding the stock that backs this narrative. Owned by
    /// this narrative's PDA; pinned at creation and enforced thereafter.
    pub vault: Address,
    /// Which token program the stock mint belongs to. xStocks are Token-2022,
    /// so this cannot be assumed to be the classic SPL Token program.
    pub stock_token_program: Address,
    pub name: [u8; MAX_NAME_LEN],
    pub symbol: [u8; MAX_SYMBOL_LEN],
    created_ts: [u8; 8],
    expiry_ts: [u8; 8],
    /// Stock base units for the first token.
    base_price: [u8; 8],
    /// Stock base units added to the price per token sold.
    slope: [u8; 8],
    /// Tokens outstanding.
    supply: [u8; 8],
    /// Supply frozen at expiry — the redeem denominator.
    final_supply: [u8; 8],
    /// Vault balance frozen at expiry — the redeem numerator.
    final_vault: [u8; 8],
    fee_bps: [u8; 2],
    sell_tax_bps: [u8; 2],
    /// A [`Status`] discriminant.
    pub status: u8,
    pub name_len: u8,
    pub symbol_len: u8,
    pub bump: u8,
    /// Decimals of the stock mint, needed for `TransferChecked`.
    pub stock_decimals: u8,
    pub _reserved: [u8; 13],
}

/// Total account size including the 2-byte header.
pub const NARRATIVE_LEN: usize = HEADER + 280;

const _: () = assert!(
    core::mem::size_of::<Narrative>() == 280,
    "unexpected padding in Narrative",
);
const _: () = assert!(
    core::mem::align_of::<Narrative>() == 1,
    "Narrative must be alignment 1 for unaligned zero-copy reads",
);

impl Narrative {
    /// Validates the header and reinterprets the payload.
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        Self::check(data)?;
        // SAFETY: `Narrative` is `#[repr(C)]` with alignment 1 (asserted above),
        // so any byte offset is correctly aligned, and `check` guarantees the
        // slice is long enough.
        Ok(unsafe { &*(data[HEADER..].as_ptr() as *const Self) })
    }

    /// Mutable counterpart to [`Narrative::from_bytes`].
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        Self::check(data)?;
        // SAFETY: see `from_bytes`.
        Ok(unsafe { &mut *(data[HEADER..].as_mut_ptr() as *mut Self) })
    }

    /// Writes the header into a freshly allocated account and returns the payload.
    pub fn initialize(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < NARRATIVE_LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }
        if data[0] != 0 {
            return Err(MarketError::AlreadyInitialized.into());
        }
        data[0] = DISCRIMINATOR;
        data[1] = VERSION;
        // SAFETY: see `from_bytes`; the header was just written.
        Ok(unsafe { &mut *(data[HEADER..].as_mut_ptr() as *mut Self) })
    }

    fn check(data: &[u8]) -> Result<(), ProgramError> {
        if data.len() < NARRATIVE_LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }
        // Guards against type cosplay — passing some other account's bytes.
        if data[0] != DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        // A stale layout is worse than a missing account: same size, wrong
        // fields.
        if data[1] != VERSION {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init(
        &mut self,
        creator: &Address,
        stock_mint: &Address,
        narrative_mint: &Address,
        vault: &Address,
        stock_token_program: &Address,
        name: &[u8],
        symbol: &[u8],
        created_ts: i64,
        expiry_ts: i64,
        base_price: u64,
        slope: u64,
        fee_bps: u16,
        sell_tax_bps: u16,
        stock_decimals: u8,
        bump: u8,
    ) -> Result<(), MarketError> {
        if name.is_empty() || name.len() > MAX_NAME_LEN {
            return Err(MarketError::InvalidInstructionData);
        }
        if symbol.is_empty() || symbol.len() > MAX_SYMBOL_LEN {
            return Err(MarketError::InvalidInstructionData);
        }

        self.creator = *creator;
        self.stock_mint = *stock_mint;
        self.narrative_mint = *narrative_mint;
        self.vault = *vault;
        self.stock_token_program = *stock_token_program;

        self.name = [0u8; MAX_NAME_LEN];
        self.name[..name.len()].copy_from_slice(name);
        self.name_len = name.len() as u8;

        self.symbol = [0u8; MAX_SYMBOL_LEN];
        self.symbol[..symbol.len()].copy_from_slice(symbol);
        self.symbol_len = symbol.len() as u8;

        self.created_ts = created_ts.to_le_bytes();
        self.expiry_ts = expiry_ts.to_le_bytes();
        self.base_price = base_price.to_le_bytes();
        self.slope = slope.to_le_bytes();
        self.supply = 0u64.to_le_bytes();
        self.final_supply = 0u64.to_le_bytes();
        self.final_vault = 0u64.to_le_bytes();
        self.fee_bps = fee_bps.to_le_bytes();
        self.sell_tax_bps = sell_tax_bps.to_le_bytes();
        self.status = Status::Live as u8;
        self.stock_decimals = stock_decimals;
        self.bump = bump;
        self._reserved = [0u8; 13];
        Ok(())
    }

    pub fn status(&self) -> Result<Status, ProgramError> {
        Status::try_from(self.status)
    }

    pub fn set_status(&mut self, status: Status) {
        self.status = status as u8;
    }

    pub fn name(&self) -> &[u8] {
        &self.name[..self.name_len as usize]
    }

    pub fn symbol(&self) -> &[u8] {
        &self.symbol[..self.symbol_len as usize]
    }

    pub fn created_ts(&self) -> i64 {
        i64::from_le_bytes(self.created_ts)
    }

    pub fn expiry_ts(&self) -> i64 {
        i64::from_le_bytes(self.expiry_ts)
    }

    pub fn base_price(&self) -> u64 {
        u64::from_le_bytes(self.base_price)
    }

    pub fn slope(&self) -> u64 {
        u64::from_le_bytes(self.slope)
    }

    pub fn supply(&self) -> u64 {
        u64::from_le_bytes(self.supply)
    }

    pub fn final_supply(&self) -> u64 {
        u64::from_le_bytes(self.final_supply)
    }

    pub fn final_vault(&self) -> u64 {
        u64::from_le_bytes(self.final_vault)
    }

    pub fn fee_bps(&self) -> u16 {
        u16::from_le_bytes(self.fee_bps)
    }

    pub fn sell_tax_bps(&self) -> u16 {
        u16::from_le_bytes(self.sell_tax_bps)
    }

    pub fn credit_supply(&mut self, amount: u64) -> Result<(), MarketError> {
        self.supply = self
            .supply()
            .checked_add(amount)
            .ok_or(MarketError::MathOverflow)?
            .to_le_bytes();
        Ok(())
    }

    pub fn debit_supply(&mut self, amount: u64) -> Result<(), MarketError> {
        self.supply = self
            .supply()
            .checked_sub(amount)
            .ok_or(MarketError::InsufficientSupply)?
            .to_le_bytes();
        Ok(())
    }

    /// Freezes the two numbers redemption divides against.
    pub fn freeze(&mut self, vault_balance: u64) {
        self.final_supply = self.supply;
        self.final_vault = vault_balance.to_le_bytes();
    }
}

impl Narrative {
    /// Seeds this narrative's PDA signs with, minus the bump.
    pub fn signer_seeds(&self) -> [&[u8]; 2] {
        [NARRATIVE_SEED, self.narrative_mint.as_ref()]
    }
}
