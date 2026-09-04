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

/** `["vault", narrative]` — token account holding the backing stock. */
export function findVault(narrative: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: NARRATIVE_MARKETS_PROGRAM_ID,
    seeds: [seed("vault"), bytes(narrative)],
  });
}
