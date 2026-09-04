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
  "7WbnkZ57UvAPzy3rNqErZW57xnhUdnqwXnDm34dGV2SX",
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
 * `["narrative", stock_mint, creator, name]`
 *
 * Seeding on the name means one creator gets one narrative per name per stock,
 * while anyone else may reuse the name.
 */
export function findNarrative(
  stockMint: Address,
  creator: Address,
  name: string,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    seeds: [seed("narrative"), bytes(stockMint), bytes(creator), seed(name)],
  });
}

/** `["mint", narrative]` */
export function findNarrativeMint(
  narrative: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    seeds: [seed("mint"), bytes(narrative)],
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
