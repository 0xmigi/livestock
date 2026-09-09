/**
 * Simulates the exact buy transaction the app builds, for a given wallet, and
 * prints the program logs. Diagnostic tool.
 *
 *   BUYER=<address> NARRATIVE=<address> pnpm --filter @nm/scripts exec tsx src/simulate-buy.ts
 */

import {
  applyBps,
  buyCost,
  decodeNarrative,
  getBuyInstruction,
} from "@nm/client";
import { findTreasuryStockAccount, TREASURY } from "@nm/client";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);

async function ata(
  mint: Address,
  owner: Address,
  tokenProgram: Address = TOKEN_PROGRAM_ADDRESS,
): Promise<Address> {
  const [pda] = await findAssociatedTokenPda({ mint, owner, tokenProgram });
  return pda;
}

/** The stock's token program, read from the mint. xStocks are Token-2022. */
async function stockTokenProgramOf(mint: Address): Promise<Address> {
  const { value } = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
  if (!value) throw new Error(`stock mint ${mint} not found`);
  return value.owner as Address;
}

async function main(): Promise<void> {
  const buyer = address(process.env.BUYER!);
  const narrativeAddress = address(process.env.NARRATIVE!);
  const tokensOut = BigInt(process.env.TOKENS ?? 238);

  const info = await rpc
    .getAccountInfo(narrativeAddress, { encoding: "base64" })
    .send();
  if (!info.value) throw new Error("narrative not found");
  const n = decodeNarrative(
    Uint8Array.from(Buffer.from(info.value.data[0], "base64")),
  );

  const cost = buyCost(n, tokensOut);
  const maxIn = cost + applyBps(cost, n.feeBps) + applyBps(cost, n.protocolFeeBps);

  const stockAta = await ata(n.stockMint, buyer, n.stockTokenProgram);
  const tokenAta = await ata(n.narrativeMint, buyer);
  const creatorFee = await ata(n.stockMint, n.creator, n.stockTokenProgram);
  const [treasury] = await findTreasuryStockAccount(n.stockMint, n.stockTokenProgram);

  console.log(`\nbuyer stock ata   ${stockAta}`);
  console.log(`buyer token ata   ${tokenAta}`);
  console.log(`creator fee ata   ${creatorFee}`);
  console.log(`vault             ${n.vault}`);
  console.log(`cost + fee        ${maxIn}\n`);

  for (const [label, addr] of [
    ["buyer stock", stockAta],
    ["creator fee", creatorFee],
  ] as const) {
    const acct = await rpc.getAccountInfo(addr, { encoding: "base64" }).send();
    console.log(`${label.padEnd(14)} ${acct.value ? "exists" : "MISSING"}`);
  }

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(buyer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(buyer),
            ata: tokenAta,
            owner: buyer,
            mint: n.narrativeMint,
          }),
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(buyer),
            ata: creatorFee,
            owner: n.creator,
            mint: n.stockMint,
            tokenProgram: n.stockTokenProgram,
          }),
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(buyer),
            ata: treasury,
            owner: TREASURY,
            mint: n.stockMint,
            tokenProgram: n.stockTokenProgram,
          }),
          getBuyInstruction({
            buyer,
            narrative: narrativeAddress,
            narrativeMint: n.narrativeMint,
            buyerTokenAccount: tokenAta,
            buyerStockAccount: stockAta,
            vault: n.vault,
            creatorFeeAccount: creatorFee,
            treasuryStockAccount: treasury,
            stockMint: n.stockMint,
            stockTokenProgram: n.stockTokenProgram,
            tokensOut,
            maxStockIn: maxIn,
          }),
        ],
        m,
      ),
    (m) => compileTransaction(m),
  );

  const result = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(tx), {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
    })
    .send();

  console.log("\n--- simulation ---");
  console.log("err:", JSON.stringify(result.value.err));
  for (const line of result.value.logs ?? []) console.log(line);
}

main().catch((error) => {
  console.error("\nfailed:", error);
  process.exit(1);
});
