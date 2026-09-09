/**
 * The keeper: what turns "expires into the stock" from a right into a fact.
 *
 * Nothing on Solana runs by itself. Once a narrative's date passes, someone
 * has to send `expire`, and then `convert` for every holder. This module
 * plans that work from chain state; a small process (a script locally, a
 * cron route in production) signs and sends it. Anyone may run one: every
 * instruction involved is permissionless and can only pay holders.
 */

import { fetchMaybeMint, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token-2022";
import {
  address,
  unwrapOption,
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";

import { decodeNarrative, NARRATIVE_ACCOUNT_LEN, NARRATIVE_DISCRIMINATOR, Status, type Narrative } from "./accounts.ts";
import { getConvertInstruction, getExpireInstruction } from "./instructions.ts";
import { findTreasuryStockAccount, TREASURY } from "./pdas.ts";
import { findNarrative, NARRATIVE_MARKETS_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./pdas.ts";

/** Holders paid per transaction. Each convert touches eight accounts. */
export const CONVERTS_PER_TX = 4;

export type Holding = { tokenAccount: Address; owner: Address; amount: bigint };

export type KeeperPlan = {
  /** Past their date, still live: send `expire`. */
  toExpire: { address: Address; narrative: Narrative }[];
  /** Expired with holders left: send `convert` for each. */
  toConvert: { address: Address; narrative: Narrative; holders: Holding[] }[];
  /** Expired, but the mint predates permanent delegates: holders must redeem themselves. */
  manualOnly: { address: Address; narrative: Narrative }[];
};

function decode64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** Every narrative the program knows, with its address. */
export async function fetchNarratives(
  rpc: Rpc<SolanaRpcApi>,
): Promise<{ address: Address; narrative: Narrative }[]> {
  const accounts = await rpc
    .getProgramAccounts(NARRATIVE_MARKETS_PROGRAM_ID, {
      encoding: "base64",
      filters: [{ dataSize: BigInt(NARRATIVE_ACCOUNT_LEN) }],
    })
    .send();
  const out: { address: Address; narrative: Narrative }[] = [];
  for (const { pubkey, account } of accounts) {
    const data = decode64(account.data[0]);
    if (data[0] !== NARRATIVE_DISCRIMINATOR) continue;
    let narrative: Narrative;
    try {
      narrative = decodeNarrative(data);
    } catch {
      continue;
    }
    const [expected] = await findNarrative(narrative.narrativeMint);
    if (expected === pubkey) out.push({ address: pubkey, narrative });
  }
  return out;
}

/** Whether the narrative can burn on holders' behalf. */
export async function convertsAutomatically(
  rpc: Rpc<SolanaRpcApi>,
  narrativeAddress: Address,
  narrativeMint: Address,
): Promise<boolean> {
  const mint = await fetchMaybeMint(rpc, narrativeMint);
  if (!mint.exists) return false;
  const extensions = unwrapOption(mint.data.extensions) ?? [];
  const delegate = extensions.find((e) => e.__kind === "PermanentDelegate");
  return delegate?.__kind === "PermanentDelegate" && delegate.delegate === narrativeAddress;
}

/**
 * Who still holds a narrative token. The RPC lists the twenty largest
 * accounts; a keeper pays those and asks again, so any number of holders is
 * reached in rounds.
 */
export async function fetchHolders(rpc: Rpc<SolanaRpcApi>, narrativeMint: Address): Promise<Holding[]> {
  const { value: largest } = await rpc.getTokenLargestAccounts(narrativeMint).send();
  const held = largest.filter((a) => BigInt(a.amount) > 0n);
  if (held.length === 0) return [];
  const { value: infos } = await rpc
    .getMultipleAccounts(
      held.map((a) => a.address),
      { encoding: "jsonParsed" },
    )
    .send();
  const out: Holding[] = [];
  infos.forEach((info, i) => {
    const parsed = info?.data as { parsed?: { info?: { owner?: string } } } | undefined;
    const owner = parsed && "parsed" in parsed ? parsed.parsed?.info?.owner : undefined;
    if (owner) out.push({ tokenAccount: held[i].address, owner: address(owner), amount: BigInt(held[i].amount) });
  });
  return out;
}

/** What a keeper should do right now. */
export async function planKeeperPass(rpc: Rpc<SolanaRpcApi>, nowSeconds: number): Promise<KeeperPlan> {
  const plan: KeeperPlan = { toExpire: [], toConvert: [], manualOnly: [] };
  for (const entry of await fetchNarratives(rpc)) {
    const { address: addr, narrative } = entry;
    if (narrative.status === Status.Live) {
      if (Number(narrative.expiryTs) <= nowSeconds) plan.toExpire.push(entry);
      continue;
    }
    if (narrative.status !== Status.Expired) continue;
    if (!(await convertsAutomatically(rpc, addr, narrative.narrativeMint))) {
      plan.manualOnly.push(entry);
      continue;
    }
    const holders = await fetchHolders(rpc, narrative.narrativeMint);
    if (holders.length > 0) plan.toConvert.push({ ...entry, holders });
  }
  return plan;
}

/**
 * The instructions for one `expire`: the treasury's stock account is created
 * if missing (the payer covers rent, once per stock), then the narrative is
 * expired, which pays the conversion fee into it.
 */
export async function expireInstructions(
  payer: TransactionSigner,
  entry: { address: Address; narrative: Narrative },
): Promise<Instruction[]> {
  const n = entry.narrative;
  const [treasury] = await findTreasuryStockAccount(n.stockMint, n.stockTokenProgram);
  return [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: treasury,
      owner: TREASURY,
      mint: n.stockMint,
      tokenProgram: n.stockTokenProgram,
    }),
    getExpireInstruction({
      narrative: entry.address,
      narrativeMint: n.narrativeMint,
      vault: n.vault,
      stockMint: n.stockMint,
      treasuryStockAccount: treasury,
      stockTokenProgram: n.stockTokenProgram,
    }),
  ];
}

/**
 * The instructions that pay a batch of holders out: each one's stock account
 * is created if missing (the payer covers rent), then converted.
 */
export async function convertInstructions(
  payer: TransactionSigner,
  entry: { address: Address; narrative: Narrative },
  holders: Holding[],
): Promise<Instruction[]> {
  const n = entry.narrative;
  const out: Instruction[] = [];
  for (const holder of holders) {
    const [stockAccount] = await findAssociatedTokenPda({
      mint: n.stockMint,
      owner: holder.owner,
      tokenProgram: n.stockTokenProgram,
    });
    out.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer,
        ata: stockAccount,
        owner: holder.owner,
        mint: n.stockMint,
        tokenProgram: n.stockTokenProgram,
      }),
      getConvertInstruction({
        narrative: entry.address,
        narrativeMint: n.narrativeMint,
        holderTokenAccount: holder.tokenAccount,
        holderStockAccount: stockAccount,
        vault: n.vault,
        stockMint: n.stockMint,
        stockTokenProgram: n.stockTokenProgram,
      }),
    );
  }
  return out;
}

/** Splits holders into transaction-sized batches. */
export function batches<T>(items: T[], size = CONVERTS_PER_TX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export { TOKEN_2022_PROGRAM_ID as NARRATIVE_TOKEN_PROGRAM_ID };
