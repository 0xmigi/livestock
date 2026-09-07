/**
 * Buys into a devnet narrative the way the app does, from a local keypair:
 * SOL → stand-in stock through the faucet, then the program's `buy`, in one
 * transaction co-signed by the running app's /api/devnet/swap routes.
 *
 *   BUYER_KEYPAIR=<path> [NARRATIVE=<address>] [SOL=0.05] [APP=http://localhost:3000] \
 *     pnpm --filter @nm/scripts exec tsx src/swap-buy.ts
 *
 * With no NARRATIVE, the first live narrative on a pinned stock is used.
 */

import { readFileSync } from "node:fs";

import {
  applyBps,
  buyCost,
  decodeNarrative,
  findNarrative,
  getBuyInstruction,
  isTradable,
  NARRATIVE_ACCOUNT_LEN,
  NARRATIVE_DISCRIMINATOR,
  NARRATIVE_MARKETS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  tokensForStock,
  type Narrative,
} from "@nm/client";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase64Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const APP = process.env.APP ?? "http://localhost:3000";
const rpc = createSolanaRpc(RPC_URL);

async function ata(mint: Address, owner: Address, tokenProgram: Address): Promise<Address> {
  const [pda] = await findAssociatedTokenPda({ mint, owner, tokenProgram });
  return pda;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(`${path}: ${json.error ?? response.status}`);
  return json;
}

function decode64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

async function pickNarrative(): Promise<{ address: Address; narrative: Narrative }> {
  const wanted = process.env.NARRATIVE ? address(process.env.NARRATIVE) : null;
  const accounts = await rpc
    .getProgramAccounts(NARRATIVE_MARKETS_PROGRAM_ID, {
      encoding: "base64",
      filters: [{ dataSize: BigInt(NARRATIVE_ACCOUNT_LEN) }],
    })
    .send();
  const now = Math.floor(Date.now() / 1000);
  for (const { pubkey, account } of accounts) {
    const data = decode64(account.data[0]);
    if (data[0] !== NARRATIVE_DISCRIMINATOR) continue;
    const narrative = decodeNarrative(data);
    const [expected] = await findNarrative(narrative.narrativeMint);
    if (expected !== pubkey) continue;
    if (wanted ? pubkey === wanted : isTradable(narrative, now)) {
      return { address: pubkey, narrative };
    }
  }
  throw new Error("no matching narrative");
}

async function main(): Promise<void> {
  const buyer = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(process.env.BUYER_KEYPAIR!, "utf8")) as number[]),
  );
  const sol = Number(process.env.SOL ?? "0.05");
  const lamports = BigInt(Math.round(sol * 1e9));

  const { address: narrativeAddress, narrative } = await pickNarrative();
  console.log(`buyer      ${buyer.address}`);
  console.log(`narrative  ${narrativeAddress} (${narrative.name}, converts to ${narrative.stockMint})`);

  // 1. Quote the faucet swap.
  const quote = await post<{ stockOut: string; faucet: string; faucetAta: string; solUsd: number; stockUsd: number }>(
    "/api/devnet/swap/quote",
    { stockMint: narrative.stockMint, lamports: lamports.toString() },
  );
  const stockOut = BigInt(quote.stockOut);
  console.log(`quote      ${sol} SOL ($${(sol * quote.solUsd).toFixed(2)}) -> ${stockOut} units of stock at $${quote.stockUsd.toFixed(2)}`);

  // 2. Size the buy from what the swap delivers.
  const tokens = tokensForStock(narrative, narrative.supply, stockOut, narrative.feeBps);
  const cost = buyCost(narrative, tokens);
  const maxIn = cost + applyBps(cost, narrative.feeBps);
  console.log(`buy        ${tokens} ${narrative.symbol}, spending up to ${maxIn} stock units`);
  if (tokens === 0n) throw new Error("that much SOL does not buy one token");

  const program = narrative.stockTokenProgram;
  const faucet = address(quote.faucet);
  const buyerStock = await ata(narrative.stockMint, buyer.address, program);
  const buyerTokens = await ata(narrative.narrativeMint, buyer.address, TOKEN_2022_PROGRAM_ID);
  const creatorFee = await ata(narrative.stockMint, narrative.creator, program);

  const instructions: Instruction[] = [
    getTransferSolInstruction({ source: createNoopSigner(buyer.address), destination: faucet, amount: lamports }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(buyer.address),
      ata: buyerStock,
      owner: buyer.address,
      mint: narrative.stockMint,
      tokenProgram: program,
    }),
    getTransferCheckedInstruction(
      {
        source: address(quote.faucetAta),
        mint: narrative.stockMint,
        destination: buyerStock,
        authority: createNoopSigner(faucet),
        amount: stockOut,
        decimals: narrative.stockDecimals,
      },
      { programAddress: program },
    ),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(buyer.address),
      ata: buyerTokens,
      owner: buyer.address,
      mint: narrative.narrativeMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(buyer.address),
      ata: creatorFee,
      owner: narrative.creator,
      mint: narrative.stockMint,
      tokenProgram: program,
    }),
    getBuyInstruction({
      buyer: buyer.address,
      narrative: narrativeAddress,
      narrativeMint: narrative.narrativeMint,
      buyerTokenAccount: buyerTokens,
      buyerStockAccount: buyerStock,
      vault: narrative.vault,
      creatorFeeAccount: creatorFee,
      stockMint: narrative.stockMint,
      stockTokenProgram: program,
      tokensOut: tokens,
      maxStockIn: maxIn,
    }),
  ];

  // 3. Compile, have the faucet co-sign, sign, send.
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(buyer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const compiled = compileTransaction(message);

  const { signature: faucetSig } = await post<{ signature: string }>("/api/devnet/swap/sign", {
    message: getBase64Decoder().decode(compiled.messageBytes),
  });
  console.log(`faucet     co-signed`);

  const withFaucet: Transaction = {
    ...compiled,
    signatures: { ...compiled.signatures, [faucet]: new Uint8Array(getBase64Encoder().encode(faucetSig)) as SignatureBytes },
  };
  const signed = await partiallySignTransaction([buyer.keyPair], withFaucet);

  const signature = await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" })
    .send();
  console.log(`sent       ${signature}`);

  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      console.log(`confirmed  ${status.confirmationStatus}`);
      const { value: held } = await rpc.getTokenAccountBalance(buyerTokens).send();
      const { value: stockLeft } = await rpc.getTokenAccountBalance(buyerStock).send();
      console.log(`holds      ${held.amount} ${narrative.symbol}, ${stockLeft.uiAmountString} stock left over`);
      console.log(`explorer   https://explorer.solana.com/tx/${signature}?cluster=devnet`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timed out waiting for confirmation");
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
