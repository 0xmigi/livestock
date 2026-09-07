/**
 * PDA derivations, mirroring the seed constants in the program's state module.
 */

import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";

export const NARRATIVE_MARKETS_PROGRAM_ID = address(
  "5X7RTCFFLgCpsRiskzm1gBEQmbzBEL39H6WpN9YzSizB",
);

export const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

const addressEncoder = getAddressEncoder();
const encoder = new TextEncoder();

const seed = (s: string) => encoder.encode(s);
const bytes = (a: Address): Uint8Array =>
  new Uint8Array(addressEncoder.encode(a));

/**
 * `["narrative", narrative_mint]`
 *
 * The mint is a plain keypair the creator brings — which is what allows a
 * vanity address to be ground — so the narrative account hangs off it. One
 * fixed seed, and no name bytes to thread through signer-seed arrays.
 */
export function findNarrative(
  narrativeMint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    seeds: [seed("narrative"), bytes(narrativeMint)],
  });
}

export const TOKEN_2022_PROGRAM_ID = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/**
 * The vault's associated token account for a narrative.
 *
 * The vault is not a PDA of this program: it is an ordinary associated token
 * account owned by the narrative PDA. Tokenized stocks are Token-2022 mints
 * whose extensions determine the account size, and the ATA program computes
 * that correctly — hand-allocating it would break the moment an issuer adds an
 * extension.
 */
export function findVault(
  narrative: Address,
  stockMint: Address,
  stockTokenProgram: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [bytes(narrative), bytes(stockTokenProgram), bytes(stockMint)],
  });
}
