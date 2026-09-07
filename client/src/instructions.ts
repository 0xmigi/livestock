/**
 * Instruction builders.
 *
 * The program is Pinocchio, so there is no IDL — instruction data is encoded by
 * hand here and must stay in step with
 * `programs/livestock/src/lib.rs`.
 */

import { AccountRole, type Address, type Instruction } from "@solana/kit";
import {
  NARRATIVE_MARKETS_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "./pdas.ts";

/**
 * Narrative mints are Token-2022, matching what launchpads issue. The *stock*
 * may be either program, so it is always passed explicitly.
 */
const NARRATIVE_TOKEN_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;

export enum NarrativeInstruction {
  CreateNarrative = 0,
  Buy = 1,
  Sell = 2,
  Expire = 3,
  Redeem = 4,
  Convert = 5,
}

const w = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const r = (address: Address) => ({ address, role: AccountRole.READONLY });
const ws = (address: Address) => ({
  address,
  role: AccountRole.WRITABLE_SIGNER,
});
const rs = (address: Address) => ({
  address,
  role: AccountRole.READONLY_SIGNER,
});

function encode(
  discriminator: NarrativeInstruction,
  ...parts: Uint8Array[]
): Uint8Array {
  const length = 1 + parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(length);
  out[0] = discriminator;
  let offset = 1;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u64le(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, value, true);
  return buf;
}

function i64le(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, value, true);
  return buf;
}

function u16le(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

export type CreateNarrativeInput = {
  creator: Address;
  narrative: Address;
  stockMint: Address;
  narrativeMint: Address;
  vault: Address;
  /** Classic SPL Token or Token-2022, depending on the stock. */
  stockTokenProgram: Address;
  name: string;
  symbol: string;
  /** Unix seconds. Immutable once set. */
  expiryTs: bigint;
  /**
   * The curve's opening virtual stock reserve, in stock base units — what
   * 30 SOL is worth in the stock. See `initialVirtualStock`.
   */
  virtualStock: bigint;
  feeBps: number;
  sellTaxBps: number;
};

export function getCreateNarrativeInstruction(
  input: CreateNarrativeInput,
): Instruction {
  const name = new TextEncoder().encode(input.name);
  const symbol = new TextEncoder().encode(input.symbol);
  if (name.length === 0 || name.length > 32) {
    throw new Error("name must be 1-32 bytes");
  }
  if (symbol.length === 0 || symbol.length > 10) {
    throw new Error("symbol must be 1-10 bytes");
  }

  return {
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    accounts: [
      ws(input.creator),
      w(input.narrative),
      r(input.stockMint),
      r(input.narrativeMint),
      r(input.vault),
      r(SYSTEM_PROGRAM_ID),
      r(input.stockTokenProgram),
    ],
    data: encode(
      NarrativeInstruction.CreateNarrative,
      i64le(input.expiryTs),
      u64le(input.virtualStock),
      u16le(input.feeBps),
      u16le(input.sellTaxBps),
      new Uint8Array([name.length]),
      name,
      symbol,
    ),
  };
}

export type BuyInput = {
  buyer: Address;
  narrative: Address;
  narrativeMint: Address;
  buyerTokenAccount: Address;
  /** The buyer's stock account — where payment comes from. */
  buyerStockAccount: Address;
  vault: Address;
  /** The creator's stock account — receives the fee. */
  creatorFeeAccount: Address;
  stockMint: Address;
  stockTokenProgram: Address;
  /** Tokens to mint. Narrative mints have 0 decimals. */
  tokensOut: bigint;
  /** Slippage bound, in stock base units, curve cost plus fee. */
  maxStockIn: bigint;
};

export function getBuyInstruction(input: BuyInput): Instruction {
  return {
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    accounts: [
      rs(input.buyer),
      w(input.narrative),
      w(input.narrativeMint),
      w(input.buyerTokenAccount),
      w(input.buyerStockAccount),
      w(input.vault),
      w(input.creatorFeeAccount),
      r(input.stockMint),
      r(NARRATIVE_TOKEN_PROGRAM_ID),
      r(input.stockTokenProgram),
    ],
    data: encode(
      NarrativeInstruction.Buy,
      u64le(input.tokensOut),
      u64le(input.maxStockIn),
    ),
  };
}

export type SellInput = {
  seller: Address;
  narrative: Address;
  narrativeMint: Address;
  sellerTokenAccount: Address;
  sellerStockAccount: Address;
  vault: Address;
  stockMint: Address;
  stockTokenProgram: Address;
  tokensIn: bigint;
  /** Slippage bound, in stock base units, net of the sell tax. */
  minStockOut: bigint;
};

export function getSellInstruction(input: SellInput): Instruction {
  return {
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    accounts: [
      rs(input.seller),
      w(input.narrative),
      w(input.narrativeMint),
      w(input.sellerTokenAccount),
      w(input.sellerStockAccount),
      w(input.vault),
      r(input.stockMint),
      r(NARRATIVE_TOKEN_PROGRAM_ID),
      r(input.stockTokenProgram),
    ],
    data: encode(
      NarrativeInstruction.Sell,
      u64le(input.tokensIn),
      u64le(input.minStockOut),
    ),
  };
}

export type ExpireInput = {
  narrative: Address;
  narrativeMint: Address;
  vault: Address;
};

/** Permissionless once the expiry date has passed. Needs no signer. */
export function getExpireInstruction(input: ExpireInput): Instruction {
  return {
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    accounts: [
      w(input.narrative),
      w(input.narrativeMint),
      r(input.vault),
      r(NARRATIVE_TOKEN_PROGRAM_ID),
    ],
    data: encode(NarrativeInstruction.Expire),
  };
}

export type RedeemInput = {
  holder: Address;
  narrative: Address;
  narrativeMint: Address;
  holderTokenAccount: Address;
  /** Stock account that receives the payout. */
  holderStockAccount: Address;
  vault: Address;
  stockMint: Address;
  stockTokenProgram: Address;
};

export function getRedeemInstruction(input: RedeemInput): Instruction {
  return {
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    accounts: [
      rs(input.holder),
      w(input.narrative),
      w(input.narrativeMint),
      w(input.holderTokenAccount),
      w(input.holderStockAccount),
      w(input.vault),
      r(input.stockMint),
      r(NARRATIVE_TOKEN_PROGRAM_ID),
      r(input.stockTokenProgram),
    ],
    data: encode(NarrativeInstruction.Redeem),
  };
}

export type ConvertInput = {
  narrative: Address;
  narrativeMint: Address;
  /** The holder's narrative token account; its owner receives the payout. */
  holderTokenAccount: Address;
  /** A stock account owned by that same holder. */
  holderStockAccount: Address;
  vault: Address;
  stockMint: Address;
  stockTokenProgram: Address;
};

/**
 * Pays one holder out after expiry without their signature. Permissionless:
 * whoever sends it pays the fee, and the payout can only go to the holder.
 */
export function getConvertInstruction(input: ConvertInput): Instruction {
  return {
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    accounts: [
      w(input.narrative),
      w(input.narrativeMint),
      w(input.holderTokenAccount),
      w(input.holderStockAccount),
      w(input.vault),
      r(input.stockMint),
      r(NARRATIVE_TOKEN_PROGRAM_ID),
      r(input.stockTokenProgram),
    ],
    data: encode(NarrativeInstruction.Convert),
  };
}
