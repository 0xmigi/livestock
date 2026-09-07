/**
 * Custom program errors, mirroring
 * `programs/livestock/src/error.rs`. The program surfaces these as
 * `ProgramError::Custom(n)`, which appears in logs as
 * `custom program error: 0x<n>`.
 */

export enum MarketErrorCode {
  NotLive = 0,
  NotExpired = 1,
  Expired = 2,
  TooEarly = 3,
  BadExpiry = 4,
  BadParameters = 5,
  ZeroAmount = 6,
  MathOverflow = 7,
  SlippageExceeded = 8,
  NothingToRedeem = 9,
  InvalidPda = 10,
  InvalidTokenAccount = 11,
  InvalidInstructionData = 12,
  AlreadyInitialized = 13,
  InsufficientSupply = 14,
  SoldOut = 15,
}

const MESSAGES: Record<MarketErrorCode, string> = {
  [MarketErrorCode.NotLive]: "This narrative is no longer trading.",
  [MarketErrorCode.NotExpired]:
    "This narrative has not been settled yet — it needs to be expired first.",
  [MarketErrorCode.Expired]: "This narrative has expired. Trading is over.",
  [MarketErrorCode.TooEarly]:
    "This narrative cannot be expired before its date.",
  [MarketErrorCode.BadExpiry]:
    "Expiry must be between 1 hour and 90 days from now.",
  [MarketErrorCode.BadParameters]: "Curve parameters or fees are out of range.",
  [MarketErrorCode.ZeroAmount]: "Enter an amount greater than zero.",
  [MarketErrorCode.MathOverflow]: "That amount is too large.",
  [MarketErrorCode.SlippageExceeded]:
    "The price moved past your limit. Try again.",
  [MarketErrorCode.NothingToRedeem]:
    "You do not hold any tokens for this narrative.",
  [MarketErrorCode.InvalidPda]:
    "An account did not match its expected address.",
  [MarketErrorCode.InvalidTokenAccount]:
    "That token account has the wrong mint or owner.",
  [MarketErrorCode.InvalidInstructionData]: "Malformed instruction data.",
  [MarketErrorCode.AlreadyInitialized]:
    "A narrative with this name already exists for this stock.",
  [MarketErrorCode.InsufficientSupply]:
    "There are not enough tokens on the curve to sell that many.",
  [MarketErrorCode.SoldOut]:
    "This narrative has sold out. Tokens come back on the curve only when someone sells.",
};

export function describeErrorCode(code: number): string | undefined {
  return MESSAGES[code as MarketErrorCode];
}

/**
 * Pulls a readable message out of an RPC failure, falling back to the raw text
 * so callers can always surface something.
 */
export function describeTransactionError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  const match = /custom program error: (0x[0-9a-fA-F]+|\d+)/.exec(raw);
  if (match) {
    const code = match[1].startsWith("0x")
      ? Number.parseInt(match[1], 16)
      : Number.parseInt(match[1], 10);
    return describeErrorCode(code) ?? `Program error ${code}`;
  }

  if (/insufficient funds|InsufficientFunds/i.test(raw)) {
    return "Not enough balance for this transaction.";
  }
  if (/user rejected|declined|cancelled|canceled/i.test(raw)) {
    return "Transaction cancelled.";
  }

  return raw;
}
