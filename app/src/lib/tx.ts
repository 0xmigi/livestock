"use client";

/**
 * Building, signing, and broadcasting through a Privy wallet.
 *
 * The app signs with Privy but broadcasts itself rather than using
 * `signAndSendTransaction`: Privy's send path confirms over its own WebSocket
 * with a hard 10s timeout, and external wallets broadcast through their own
 * RPC. Signing only keeps Privy out of the network path, so the same code works
 * against any cluster.
 */

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64Decoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { describeTransactionError } from "@nm/client";

import { rpc } from "./config";

/**
 * Compiles instructions into wire bytes for `feePayer` to sign.
 *
 * `localSigners` are keypairs the browser holds — currently just a freshly
 * generated mint, which has to sign its own `CreateAccount`. They sign here
 * and Privy adds the fee payer's signature afterwards, so the transaction
 * reaches an RPC with both.
 */
export async function buildTransaction(
  feePayer: Address,
  instructions: Instruction[],
  localSigners: KeyPairSigner[] = [],
): Promise<Uint8Array> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  const compiled = compileTransaction(message);
  const signed = localSigners.length
    ? await partiallySignTransaction(
        localSigners.map((s) => s.keyPair),
        compiled,
      )
    : compiled;

  return new Uint8Array(getTransactionEncoder().encode(signed));
}

/** Broadcasts a signed transaction and waits for confirmation. */
export async function broadcast(signedTransaction: Uint8Array): Promise<string> {
  const wire = getBase64Decoder().decode(signedTransaction);

  let signature: string;
  try {
    signature = await rpc
      .sendTransaction(wire as Parameters<typeof rpc.sendTransaction>[0], {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send();
  } catch (cause) {
    if (isBlockhashExpired(cause)) throw new BlockhashExpired();
    // A failed preflight carries the program logs in the error context, and
    // the top-level message alone ("Transaction simulation failed") says
    // nothing useful. Pull the real reason out before it reaches the user.
    throw new Error(explainSendFailure(cause));
  }

  await confirm(signature);
  return signature;
}

/** Thrown when a transaction was signed too slowly to still be broadcastable. */
class BlockhashExpired extends Error {
  constructor() {
    super("Blockhash expired");
  }
}

function isBlockhashExpired(cause: unknown): boolean {
  const serialized = JSON.stringify(
    (cause as { context?: unknown })?.context ?? "",
  );
  return (
    /blockhash not found/i.test(serialized) ||
    /blockhash not found/i.test(
      cause instanceof Error ? (cause.cause as Error)?.message ?? "" : "",
    )
  );
}

/**
 * Builds, signs, and broadcasts, retrying once if the blockhash lapsed.
 *
 * Signing is not instantaneous — an external wallet shows its own confirmation
 * — so a transaction can be signed against a blockhash that is no longer
 * valid by the time it reaches an RPC. Rebuilding and re-signing once is
 * cheaper than making the user start over.
 */
export async function signAndSend(
  feePayer: Address,
  instructions: Instruction[],
  sign: (transaction: Uint8Array) => Promise<Uint8Array>,
  localSigners: KeyPairSigner[] = [],
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Rebuilt each attempt, so a retry re-signs against a fresh blockhash.
    const transaction = await buildTransaction(
      feePayer,
      instructions,
      localSigners,
    );
    const signed = await sign(transaction);
    try {
      return await broadcast(signed);
    } catch (cause) {
      lastError = cause;
      if (!(cause instanceof BlockhashExpired)) throw cause;
    }
  }

  throw new Error(
    lastError instanceof BlockhashExpired
      ? "The transaction took too long to sign. Try again."
      : String(lastError),
  );
}

/** Digs the useful line out of an RPC send failure. */
function explainSendFailure(cause: unknown): string {
  const context = (cause as { context?: Record<string, unknown> })?.context;
  const logs = context?.logs;

  if (Array.isArray(logs)) {
    // The last "Program log:" line before the failure is usually the reason.
    const failing = [...logs]
      .reverse()
      .find(
        (line: unknown) =>
          typeof line === "string" &&
          (line.includes("failed") || line.includes("Error")),
      );
    if (typeof failing === "string") return failing;
  }

  const serverMessage = context?.__serverMessage;
  if (typeof serverMessage === "string") return serverMessage;

  return cause instanceof Error ? cause.message : String(cause);
}

async function confirm(signature: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const { value } = await rpc
      .getSignatureStatuses([signature as never])
      .send();
    const status = value[0];

    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for confirmation");
}

export { describeTransactionError as toUserMessage };
