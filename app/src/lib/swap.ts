"use client";

/**
 * The swap leg of a buy: SOL in, the narrative's stock out, in the same
 * transaction as the program's `buy`. One signature, atomic.
 *
 * Mainnet routes through Jupiter. Devnet, where tokenized stocks do not
 * exist, trades with the app's faucet wallet at the live Tokens API rate; the
 * faucet co-signs the transaction from the server (see /api/devnet/swap).
 */

import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import {
  AccountRole,
  address,
  createNoopSigner,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";

import { CLUSTER, JUPITER_MAX_ACCOUNTS, rpc } from "./config";
import type { RemoteSigner } from "./tx";

export const SOL_MINT = address("So11111111111111111111111111111111111111112");
export const LAMPORTS_PER_SOL = 1_000_000_000n;

const JUPITER_API = "https://lite-api.jup.ag/swap/v1";
/** Allowed slippage on the Jupiter leg. The program's own cap (`maxStockIn`) guards the buy. */
const JUPITER_SLIPPAGE_BPS = 100;
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");
/** Compute units the rest of the buy needs on top of the swap: three token accounts and the program. */
const BUY_COMPUTE_UNITS = 250_000;
/** The runtime's cap per transaction. */
const MAX_COMPUTE_UNITS = 1_400_000;

export type SwapQuote = {
  lamportsIn: bigint;
  /** What the swap is expected to deliver. */
  stockOut: bigint;
  /** The least it may deliver; the buy is sized from this. */
  minStockOut: bigint;
  route: "faucet" | "jupiter";
  /** Mainnet: Jupiter's quote, passed back when building the swap. Devnet: the faucet accounts. */
  detail: unknown;
};

export type SwapLeg = {
  instructions: Instruction[];
  remoteSigners: RemoteSigner[];
  lookupTables: Record<Address, Address[]>;
};

export type QuoteOptions = {
  /**
   * Mainnet: a single-pool route only. Smaller than any multi-hop route, so
   * it is the fallback when the route Jupiter chose leaves the buy no room.
   */
  direct?: boolean;
};

type Stock = { mint: Address; decimals: number; tokenProgram: Address };

async function ownerStockAta(stock: Stock, owner: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    mint: stock.mint,
    owner,
    tokenProgram: stock.tokenProgram,
  });
  return ata;
}

// --- devnet: the faucet ---------------------------------------------------

type FaucetQuote = {
  stockOut: string;
  faucet: string;
  faucetAta: string;
  solUsd: number;
  stockUsd: number;
};

async function faucetQuote(stock: Stock, lamports: bigint): Promise<SwapQuote> {
  const response = await fetch("/api/devnet/swap/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stockMint: stock.mint, lamports: lamports.toString() }),
  });
  const body = (await response.json()) as Partial<FaucetQuote> & { error?: string };
  if (!response.ok || !body.stockOut) throw new Error(body.error ?? "The swap quote failed.");
  const stockOut = BigInt(body.stockOut);
  return { lamportsIn: lamports, stockOut, minStockOut: stockOut, route: "faucet", detail: body };
}

async function faucetLeg(stock: Stock, owner: Address, quote: SwapQuote): Promise<SwapLeg> {
  const detail = quote.detail as FaucetQuote;
  const faucet = address(detail.faucet);
  const source = address(detail.faucetAta);
  const destination = await ownerStockAta(stock, owner);

  const remote: RemoteSigner = {
    address: faucet,
    sign: async (messageBytes) => {
      const response = await fetch("/api/devnet/swap/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: getBase64Decoder().decode(messageBytes) }),
      });
      const body = (await response.json()) as { signature?: string; error?: string };
      if (!response.ok || !body.signature) throw new Error(body.error ?? "The faucet refused to sign.");
      return new Uint8Array(getBase64Encoder().encode(body.signature));
    },
  };

  return {
    instructions: [
      getTransferSolInstruction({
        source: createNoopSigner(owner),
        destination: faucet,
        amount: quote.lamportsIn,
      }),
      getCreateAssociatedTokenIdempotentInstruction({
        payer: createNoopSigner(owner),
        ata: destination,
        owner,
        mint: stock.mint,
        tokenProgram: stock.tokenProgram,
      }),
      getTransferCheckedInstruction(
        {
          source,
          mint: stock.mint,
          destination,
          // A signer, so the message reserves a signature slot for the faucet.
          authority: createNoopSigner(faucet),
          amount: quote.stockOut,
          decimals: stock.decimals,
        },
        { programAddress: stock.tokenProgram },
      ),
    ],
    remoteSigners: [remote],
    lookupTables: {},
  };
}

// --- mainnet: Jupiter -----------------------------------------------------
//
// Jupiter picks a fresh route per quote, and its size varies: a three-hop
// route with its setup accounts ran a buy to 1269 bytes on mainnet, past the
// 1232-byte limit. The quote is capped at `JUPITER_MAX_ACCOUNTS`, which keeps
// routes to two hops, and the buy measures the result before signing and
// re-quotes with `direct` if it still does not fit.

type JupiterQuote = { inAmount: string; outAmount: string; otherAmountThreshold: string };

type JupiterInstruction = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};

type JupiterSwap = {
  computeBudgetInstructions?: JupiterInstruction[];
  setupInstructions?: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  cleanupInstruction?: JupiterInstruction | null;
  addressLookupTableAddresses?: string[];
};

async function jupiterQuote(stock: Stock, lamports: bigint, options: QuoteOptions): Promise<SwapQuote> {
  const route = options.direct ? "&onlyDirectRoutes=true" : `&maxAccounts=${JUPITER_MAX_ACCOUNTS}`;
  const url =
    `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${stock.mint}` +
    `&amount=${lamports}&slippageBps=${JUPITER_SLIPPAGE_BPS}${route}`;
  const response = await fetch(url);
  const body = (await response.json()) as Partial<JupiterQuote> & { error?: string };
  if (!response.ok || !body.outAmount || !body.otherAmountThreshold) {
    throw new Error(body.error ?? "Jupiter could not quote that swap.");
  }
  return {
    lamportsIn: lamports,
    stockOut: BigInt(body.outAmount),
    minStockOut: BigInt(body.otherAmountThreshold),
    route: "jupiter",
    detail: body,
  };
}

/**
 * Jupiter sizes its compute-unit limit for the swap alone (`dynamicComputeUnitLimit`).
 * The buy runs in the same transaction, so raise the limit by what it needs;
 * the price instruction and anything else pass through.
 */
function withRoomForBuy(ix: Instruction): Instruction {
  if (ix.programAddress !== COMPUTE_BUDGET_PROGRAM || !ix.data || ix.data[0] !== 2 || ix.data.length < 5) {
    return ix;
  }
  const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
  const limit = Math.min(MAX_COMPUTE_UNITS, view.getUint32(1, true) + BUY_COMPUTE_UNITS);
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, limit, true);
  return { ...ix, data };
}

function toInstruction(ix: JupiterInstruction): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((a) => ({
      address: address(a.pubkey),
      role: a.isSigner
        ? a.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : a.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: new Uint8Array(getBase64Encoder().encode(ix.data)),
  };
}

/** An address lookup table's entries: a 56-byte header, then 32-byte keys. */
async function fetchLookupTables(addresses: string[]): Promise<Record<Address, Address[]>> {
  if (addresses.length === 0) return {};
  const tables = addresses.map((a) => address(a));
  const { value } = await rpc.getMultipleAccounts(tables, { encoding: "base64" }).send();
  const out: Record<Address, Address[]> = {};
  const { getAddressDecoder } = await import("@solana/kit");
  const decoder = getAddressDecoder();
  value.forEach((account, i) => {
    if (!account) throw new Error(`Lookup table ${tables[i]} not found.`);
    const bytes = new Uint8Array(getBase64Encoder().encode(account.data[0]));
    const entries: Address[] = [];
    for (let offset = 56; offset + 32 <= bytes.length; offset += 32) {
      entries.push(decoder.decode(bytes.subarray(offset, offset + 32)));
    }
    out[tables[i]] = entries;
  });
  return out;
}

async function jupiterLeg(stock: Stock, owner: Address, quote: SwapQuote): Promise<SwapLeg> {
  const response = await fetch(`${JUPITER_API}/swap-instructions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote.detail,
      userPublicKey: owner,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  const body = (await response.json()) as Partial<JupiterSwap> & { error?: string };
  if (!response.ok || !body.swapInstruction) {
    throw new Error(body.error ?? "Jupiter could not build that swap.");
  }

  const destination = await ownerStockAta(stock, owner);
  const setup = body.setupInstructions ?? [];
  // Jupiter's setup creates the output account when it is missing, Token-2022
  // included. Make sure ourselves only when it did not: every instruction
  // costs bytes the route may need.
  const createsDestination = setup.some(
    (ix) => ix.programId === ASSOCIATED_TOKEN_PROGRAM && ix.accounts[1]?.pubkey === destination,
  );
  const instructions: Instruction[] = [
    ...(body.computeBudgetInstructions ?? []).map(toInstruction).map(withRoomForBuy),
    ...setup.map(toInstruction),
    ...(createsDestination
      ? []
      : [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(owner),
            ata: destination,
            owner,
            mint: stock.mint,
            tokenProgram: stock.tokenProgram,
          }),
        ]),
    toInstruction(body.swapInstruction),
    ...(body.cleanupInstruction ? [toInstruction(body.cleanupInstruction)] : []),
  ];

  return {
    instructions,
    remoteSigners: [],
    lookupTables: await fetchLookupTables(body.addressLookupTableAddresses ?? []),
  };
}

// --- the one entry point --------------------------------------------------

/** What `lamports` of SOL turns into, in this narrative's stock. */
export function quoteSwap(stock: Stock, lamports: bigint, options: QuoteOptions = {}): Promise<SwapQuote> {
  return CLUSTER === "mainnet" ? jupiterQuote(stock, lamports, options) : faucetQuote(stock, lamports);
}

/** The instructions that perform a quoted swap for `owner`, plus any co-signers and lookup tables. */
export function buildSwapLeg(stock: Stock, owner: Address, quote: SwapQuote): Promise<SwapLeg> {
  return quote.route === "jupiter" ? jupiterLeg(stock, owner, quote) : faucetLeg(stock, owner, quote);
}
