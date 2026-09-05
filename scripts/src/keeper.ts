/**
 * Runs the keeper in a loop: expires narratives whose date has passed and
 * pays every holder out in the stock. Uses the Solana CLI keypair (or
 * KEYPAIR) to pay fees.
 *
 *   RPC_URL=... pnpm --filter @nm/scripts run keeper
 *
 * ONCE=1 does a single pass and exits.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  batches,
  convertInstructions,
  expireInstructions,
  planKeeperPass,
} from "@nm/client";
import {
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
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.WS_URL ?? RPC_URL.replace(/^http/, "ws");
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 20_000);

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

async function loadPayer(): Promise<KeyPairSigner> {
  const path = process.env.KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

async function send(payer: KeyPairSigner, instructions: Instruction[]): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirm(signed, { commitment: "confirmed" });
  return getSignatureFromTransaction(signed);
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

async function pass(payer: KeyPairSigner): Promise<void> {
  const plan = await planKeeperPass(rpc, Math.floor(Date.now() / 1000));

  for (const entry of plan.toExpire) {
    try {
      const sig = await send(payer, expireInstructions(entry));
      console.log(`${stamp()} expired   ${entry.narrative.name} (${entry.address})  ${sig}`);
    } catch (cause) {
      console.log(`${stamp()} expire failed for ${entry.narrative.name}: ${cause instanceof Error ? cause.message : cause}`);
    }
  }

  for (const entry of plan.toConvert) {
    for (const batch of batches(entry.holders)) {
      try {
        const sig = await send(payer, await convertInstructions(payer, entry, batch));
        const who = batch.map((h) => `${h.owner.slice(0, 4)}…(${h.amount})`).join(" ");
        console.log(`${stamp()} converted ${entry.narrative.name}: ${who}  ${sig}`);
      } catch (cause) {
        console.log(`${stamp()} convert failed for ${entry.narrative.name}: ${cause instanceof Error ? cause.message : cause}`);
      }
    }
  }

  for (const entry of plan.manualOnly) {
    console.log(`${stamp()} ${entry.narrative.name} predates automatic conversion; holders redeem themselves`);
  }
}

async function main(): Promise<void> {
  const payer = await loadPayer();
  console.log(`keeper ${payer.address} on ${RPC_URL}`);
  if (process.env.ONCE) {
    await pass(payer);
    return;
  }
  for (;;) {
    try {
      await pass(payer);
    } catch (cause) {
      console.log(`${stamp()} pass failed: ${cause instanceof Error ? cause.message : cause}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
