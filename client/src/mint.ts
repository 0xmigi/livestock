/**
 * Building a narrative mint client-side.
 *
 * The program verifies the mint rather than creating it, so this is where the
 * mint actually gets built — and it has to come out in the exact shape
 * `create_narrative` insists on:
 *
 *   - Token-2022, carrying its name/symbol/URI in the mint's own
 *     `TokenMetadata` extension rather than a separate Metaplex account
 *   - zero decimals (see `curve` for why)
 *   - no freeze authority
 *   - mint authority already handed to the narrative PDA
 *
 * The mint is a plain keypair, not a PDA, which is what lets a creator grind a
 * vanity address the way every launchpad does.
 */

import { getCreateAccountInstruction } from "@solana-program/system";
import {
  AuthorityType,
  extension,
  getInitializeMetadataPointerInstruction,
  getInitializeMint2Instruction,
  getInitializeTokenMetadataInstruction,
  getMintSize,
  getSetAuthorityInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import type { Address, Instruction, TransactionSigner } from "@solana/kit";

import { NARRATIVE_DECIMALS } from "./curve.ts";

export type NarrativeMintInput = {
  /** Pays rent. Also the transient mint authority while metadata is written. */
  payer: TransactionSigner;
  /** The mint keypair — grind this for a vanity suffix if you want one. */
  mint: TransactionSigner;
  /** The narrative PDA that ends up holding mint authority. */
  narrative: Address;
  name: string;
  symbol: string;
  /** HTTPS URL of the metadata JSON. */
  uri: string;
  /** Rent for the account's final size, including the metadata extension. */
  lamports: bigint;
};

/**
 * Space to allocate up front, and the rent to fund.
 *
 * `InitializeTokenMetadata` grows the account itself and takes no payer, so
 * the mint has to already hold rent for the *final* size. Allocate for the
 * pointer only, fund for pointer plus metadata.
 */
export function getNarrativeMintSize(
  name: string,
  symbol: string,
  uri: string,
): { allocate: number; fundFor: number } {
  const allocate = Number(
    getMintSize([
      extension("MetadataPointer", {
        authority: null,
        metadataAddress: null,
      }),
    ]),
  );

  const utf8 = (s: string) => new TextEncoder().encode(s).length;
  // TLV header + update authority + mint + three length-prefixed strings +
  // an empty additional-metadata vector.
  const metadata =
    4 + 32 + 32 + (4 + utf8(name)) + (4 + utf8(symbol)) + (4 + utf8(uri)) + 4;

  return { allocate, fundFor: allocate + metadata };
}

/**
 * The instruction sequence that produces a valid narrative mint.
 *
 * Mint authority starts with the payer because `InitializeTokenMetadata`
 * requires the mint authority to sign, then moves to the narrative PDA. After
 * the last instruction nobody but the curve can mint.
 */
export function getCreateNarrativeMintInstructions(
  input: NarrativeMintInput,
): Instruction[] {
  const { payer, mint, narrative, name, symbol, uri, lamports } = input;
  const { allocate } = getNarrativeMintSize(name, symbol, uri);

  return [
    getCreateAccountInstruction({
      payer,
      newAccount: mint,
      lamports,
      space: BigInt(allocate),
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),

    // Points at the mint itself — the metadata lives in the mint account.
    getInitializeMetadataPointerInstruction({
      mint: mint.address,
      authority: payer.address,
      metadataAddress: mint.address,
    }),

    getInitializeMint2Instruction({
      mint: mint.address,
      decimals: NARRATIVE_DECIMALS,
      mintAuthority: payer.address,
      // No freeze authority: the program rejects a mint that has one, since it
      // would let someone strand holders before expiry.
      freezeAuthority: null,
    }),

    getInitializeTokenMetadataInstruction({
      metadata: mint.address,
      updateAuthority: payer.address,
      mint: mint.address,
      mintAuthority: payer,
      name,
      symbol,
      uri,
    }),

    // Hand minting to the narrative. This is the check the program cares most
    // about — without it the creator could keep minting beside the curve.
    getSetAuthorityInstruction({
      owned: mint.address,
      owner: payer,
      authorityType: AuthorityType.MintTokens,
      newAuthority: narrative,
    }),
  ];
}
