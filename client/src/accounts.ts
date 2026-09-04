/**
 * Decoder for the `Narrative` account.
 *
 * The layout mirrors `programs/narrative_markets/src/state.rs`. The account
 * starts with a 2-byte `[discriminator, version]` header, so every offset here
 * is the Rust struct offset plus 2.
 */

import { getAddressDecoder, type Address } from "@solana/kit";

const addressDecoder = getAddressDecoder();
const HEADER = 2;

export const NARRATIVE_DISCRIMINATOR = 1;
/**
 * Layout version. The account size did not change between v1 and v2, so
 * without checking this an older account decodes into the wrong fields
 * instead of being rejected.
 */
export const NARRATIVE_VERSION = 2;
export const NARRATIVE_ACCOUNT_LEN = HEADER + 280;

export enum Status {
  Live = 0,
  Expired = 1,
  Settled = 2,
}

export type Narrative = {
  creator: Address;
  stockMint: Address;
  narrativeMint: Address;
  /** Token account holding the backing stock, owned by the narrative PDA. */
  vault: Address;
  /**
   * Which token program the stock belongs to. Real tokenized stocks (xStocks)
   * are Token-2022, so this is not always the classic SPL Token program.
   */
  stockTokenProgram: Address;
  name: string;
  symbol: string;
  createdTs: bigint;
  expiryTs: bigint;
  basePrice: bigint;
  slope: bigint;
  supply: bigint;
  /** Frozen at expiry — the redeem denominator. */
  finalSupply: bigint;
  /** Frozen at expiry — the redeem numerator. */
  finalVault: bigint;
  feeBps: number;
  sellTaxBps: number;
  status: Status;
  /** Decimals of the stock mint, needed for `TransferChecked`. */
  stockDecimals: number;
};

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readAddress(data: Uint8Array, offset: number): Address {
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}

const text = new TextDecoder();

export function decodeNarrative(data: Uint8Array): Narrative {
  if (data.length < NARRATIVE_ACCOUNT_LEN) {
    throw new Error("Narrative account is truncated");
  }
  if (data[0] !== NARRATIVE_DISCRIMINATOR) {
    throw new Error(
      `expected a Narrative account, got discriminator ${data[0]}`,
    );
  }
  if (data[1] !== NARRATIVE_VERSION) {
    throw new Error(
      `Narrative layout v${data[1]}, expected v${NARRATIVE_VERSION}`,
    );
  }

  const v = view(data);
  const nameLen = data[HEADER + 263];
  const symbolLen = data[HEADER + 264];

  return {
    creator: readAddress(data, HEADER + 0),
    stockMint: readAddress(data, HEADER + 32),
    narrativeMint: readAddress(data, HEADER + 64),
    vault: readAddress(data, HEADER + 96),
    stockTokenProgram: readAddress(data, HEADER + 128),
    name: text.decode(data.subarray(HEADER + 160, HEADER + 160 + nameLen)),
    symbol: text.decode(data.subarray(HEADER + 192, HEADER + 192 + symbolLen)),
    createdTs: v.getBigInt64(HEADER + 202, true),
    expiryTs: v.getBigInt64(HEADER + 210, true),
    basePrice: v.getBigUint64(HEADER + 218, true),
    slope: v.getBigUint64(HEADER + 226, true),
    supply: v.getBigUint64(HEADER + 234, true),
    finalSupply: v.getBigUint64(HEADER + 242, true),
    finalVault: v.getBigUint64(HEADER + 250, true),
    feeBps: v.getUint16(HEADER + 258, true),
    sellTaxBps: v.getUint16(HEADER + 260, true),
    status: data[HEADER + 262] as Status,
    stockDecimals: data[HEADER + 266],
  };
}

// --- SPL token helpers ----------------------------------------------------

export function decodeTokenAmount(data: Uint8Array): bigint {
  return view(data).getBigUint64(64, true);
}

export function decodeMintSupply(data: Uint8Array): bigint {
  return view(data).getBigUint64(36, true);
}

export function decodeMintDecimals(data: Uint8Array): number {
  return data[44];
}

// --- derived views --------------------------------------------------------

/** Seconds until expiry, floored at zero. */
export function secondsRemaining(n: Narrative, nowSeconds: number): number {
  return Math.max(0, Number(n.expiryTs) - nowSeconds);
}

/** True once the date has passed, whether or not `expire` has been called. */
export function isPastExpiry(n: Narrative, nowSeconds: number): boolean {
  return nowSeconds >= Number(n.expiryTs);
}

/**
 * True when trading is genuinely open.
 *
 * `status` alone is not enough: a narrative stays `Live` until someone calls
 * `expire`, but the program stops accepting trades the moment the date passes.
 */
export function isTradable(n: Narrative, nowSeconds: number): boolean {
  return n.status === Status.Live && !isPastExpiry(n, nowSeconds);
}

/** True when the narrative is settled and holders can claim. */
export function isRedeemable(n: Narrative): boolean {
  return n.status === Status.Expired;
}

/** What one token converts into, in stock base units. */
export function redemptionPerToken(n: Narrative): bigint {
  if (n.finalSupply === 0n) return 0n;
  return n.finalVault / n.finalSupply;
}
