/**
 * Sells a wallet's whole position in a narrative, for stock. A development
 * tool for exercising the sell path from a local keypair.
 *
 *   KEYPAIR=<path> NARRATIVE=<address> pnpm --filter @nm/scripts exec tsx src/sell.ts
 */

import { readFileSync } from "node:fs";

import { decodeNarrative, getSellInstruction, TOKEN_2022_PROGRAM_ID } from "@nm/client";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.WS_URL ?? RPC_URL.replace(/^http/, "ws");
const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

async function main(): Promise<void> {
  const seller = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR!, "utf8")) as number[]),
  );
  const narrativeAddress = address(process.env.NARRATIVE!);
  const { value } = await rpc.getAccountInfo(narrativeAddress, { encoding: "base64" }).send();
  if (!value) throw new Error("narrative not found");
  const n = decodeNarrative(Uint8Array.from(Buffer.from(value.data[0], "base64")));

  const [tokens] = await findAssociatedTokenPda({ mint: n.narrativeMint, owner: seller.address, tokenProgram: TOKEN_2022_PROGRAM_ID });
  const [stock] = await findAssociatedTokenPda({ mint: n.stockMint, owner: seller.address, tokenProgram: n.stockTokenProgram });
  const held = BigInt((await rpc.getTokenAccountBalance(tokens).send()).value.amount);
  if (held === 0n) throw new Error("nothing to sell");
  const before = BigInt((await rpc.getTokenAccountBalance(stock).send().catch(() => ({ value: { amount: "0" } }))).value.amount);

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(seller, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: seller,
            ata: stock,
            owner: seller.address,
            mint: n.stockMint,
            tokenProgram: n.stockTokenProgram,
          }),
          getSellInstruction({
            seller: seller.address,
            narrative: narrativeAddress,
            narrativeMint: n.narrativeMint,
            sellerTokenAccount: tokens,
            sellerStockAccount: stock,
            vault: n.vault,
            stockMint: n.stockMint,
            stockTokenProgram: n.stockTokenProgram,
            tokensIn: held,
            minStockOut: 0n,
          }),
        ],
        m,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirm(signed, { commitment: "confirmed" });
  const after = BigInt((await rpc.getTokenAccountBalance(stock).send()).value.amount);
  console.log(`sold ${held} ${n.symbol} for ${Number(after - before) / 10 ** n.stockDecimals} stock units  ${getSignatureFromTransaction(signed)}`);
}

main().catch((cause) => {
  const c = cause as { message?: string; context?: unknown; cause?: unknown };
  console.error(c?.message ?? cause);
  if (c?.context) console.error(JSON.stringify(c.context, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1).slice(0, 1500));
  if (c?.cause) console.error("cause:", (c.cause as { message?: string })?.message ?? c.cause);
  process.exit(1);
});
