/**
 * One keeper pass, for a scheduler to call: expires narratives past their
 * date and pays every holder out in the stock. See client/src/keeper.ts.
 *
 * Fees come from KEEPER_KEYPAIR (on devnet, the faucet's key stands in: it
 * collects SOL from every buy). An external scheduler sends CRON_SECRET as a
 * bearer token; without one configured, the route only answers outside
 * production. The keeper script is the primary way to run this; the route
 * exists for hosts that cannot keep a process alive.
 */

import { NextResponse } from "next/server";
import { batches, convertInstructions, expireInstructions, planKeeperPass } from "@nm/client";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

import { rpc } from "@/lib/server/rpc";

export const maxDuration = 60;

async function payer(): Promise<KeyPairSigner> {
  const raw =
    process.env.KEEPER_KEYPAIR ??
    (process.env.NEXT_PUBLIC_CLUSTER !== "mainnet" ? process.env.DEVNET_FAUCET_KEYPAIR : undefined);
  if (!raw) throw new Error("KEEPER_KEYPAIR is not set.");
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(raw) as number[]));
}

async function send(signer: KeyPairSigner, instructions: Instruction[]): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  return rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" })
    .send();
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const signer = await payer();
    const plan = await planKeeperPass(rpc, Math.floor(Date.now() / 1000));
    const expired: string[] = [];
    const converted: string[] = [];
    const failed: string[] = [];

    for (const entry of plan.toExpire) {
      try {
        expired.push(await send(signer, await expireInstructions(signer, entry)));
      } catch (cause) {
        failed.push(`expire ${entry.narrative.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    for (const entry of plan.toConvert) {
      for (const batch of batches(entry.holders)) {
        try {
          converted.push(await send(signer, await convertInstructions(signer, entry, batch)));
        } catch (cause) {
          failed.push(`convert ${entry.narrative.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
    }

    return NextResponse.json({
      expired,
      converted,
      manualOnly: plan.manualOnly.map((e) => e.narrative.name),
      failed,
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 500 });
  }
}
