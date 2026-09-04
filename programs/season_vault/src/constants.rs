pub const VAULT_SEED: &[u8] = b"vault";
pub const SEASON_SEED: &[u8] = b"season";
pub const NARRATIVE_MINT_SEED: &[u8] = b"narrative_mint";
pub const STOCK_VAULT_SEED: &[u8] = b"stock_vault";
pub const MARKET_MAKER_SEED: &[u8] = b"market_maker";
pub const CURVE_SOL_SEED: &[u8] = b"curve_sol";
pub const POSITION_SEED: &[u8] = b"position";

pub const NAME_MAX_LEN: usize = 32;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// Linear curve defaults (lamports). price = base + slope * whole_tokens.
pub const DEFAULT_BASE: u64 = 10_000_000; // 0.01 SOL
pub const DEFAULT_SLOPE: u64 = 100;
