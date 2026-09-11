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
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64Decoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { describeTransactionError } from "@nm/client";

import { rpc } from "./config";

/**
 * A co-signer that lives somewhere else — the devnet faucet, on the server.
 * It is handed the compiled message and returns its 64-byte signature.
 */
export type RemoteSigner = {
  address: Address;
  sign: (messageBytes: Uint8Array) => Promise<Uint8Array>;
};

export type BuildOptions = {
  /** Keypairs the browser holds, e.g. a freshly generated mint. */
  localSigners?: KeyPairSigner[];
  remoteSigners?: RemoteSigner[];
  /** Address lookup tables, so a Jupiter route fits in one transaction. */
  lookupTables?: Record<Address, Address[]>;
};

/** The most bytes a transaction may be on the wire, signatures included. */
export const TRANSACTION_SIZE_LIMIT = 1232;

/** Thrown before signing when the compiled transaction cannot be sent. */
export class TransactionTooLarge extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(`This transaction is ${bytes} bytes; the network takes at most ${TRANSACTION_SIZE_LIMIT}.`);
    this.bytes = bytes;
  }
}

type Lifetime = Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0];

/** Any blockhash gives the same size, so measuring needs no RPC round trip. */
const PLACEHOLDER_LIFETIME: Lifetime = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 0n,
};

function compile(
  feePayer: Address,
  instructions: Instruction[],
  lookupTables: Record<Address, Address[]>,
  lifetime: Lifetime,
): Transaction {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) =>
      Object.keys(lookupTables).length > 0
        ? compressTransactionMessageUsingAddressLookupTables(m, lookupTables)
        : m,
  );
  return compileTransaction(message);
}

/**
 * How many bytes `instructions` come to once signed, every signer's slot
 * included. Cheap: no network, no signing.
 */
export function transactionSize(
  feePayer: Address,
  instructions: Instruction[],
  options: BuildOptions = {},
): number {
  const compiled = compile(feePayer, instructions, options.lookupTables ?? {}, PLACEHOLDER_LIFETIME);
  return getTransactionEncoder().encode(compiled).length;
}

/**
 * Compiles instructions into wire bytes for `feePayer` to sign.
 *
 * Local and remote co-signers sign here and Privy adds the fee payer's
 * signature afterwards, so the transaction reaches an RPC with all of them.
 */
export async function buildTransaction(
  feePayer: Address,
  instructions: Instruction[],
  options: BuildOptions = {},
): Promise<Uint8Array> {
  const { localSigners = [], remoteSigners = [], lookupTables = {} } = options;

  // Caught here rather than by the RPC, so the wallet never asks for a
  // signature on something that cannot be sent.
  const size = transactionSize(feePayer, instructions, options);
  if (size > TRANSACTION_SIZE_LIMIT) throw new TransactionTooLarge(size);

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const compiled = compile(feePayer, instructions, lookupTables, latestBlockhash);
  let signed: Transaction = localSigners.length
    ? await partiallySignTransaction(
        localSigners.map((s) => s.keyPair),
        compiled,
      )
    : compiled;

  for (const remote of remoteSigners) {
    const signature = await remote.sign(new Uint8Array(signed.messageBytes));
    signed = {
      ...signed,
      signatures: { ...signed.signatures, [remote.address]: signature as SignatureBytes },
    };
  }

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

/** JSON.stringify that survives bigints, which RPC error contexts carry. */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

function isBlockhashExpired(cause: unknown): boolean {
  const serialized = stringify((cause as { context?: unknown })?.context ?? "");
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
  options: BuildOptions = {},
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Rebuilt each attempt, so a retry re-signs against a fresh blockhash.
    const transaction = await buildTransaction(feePayer, instructions, options);
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
      throw new Error(`Transaction failed: ${stringify(status.err)}`);
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
