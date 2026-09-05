/**
 * Co-signs a buy transaction as the devnet faucet.
 *
 * The browser sends the compiled message. The faucet signs only if the message
 * is exactly one trade: a SOL transfer from the fee payer to the faucet and one
 * transfer of a stand-in stock from the faucet, for no more than the SOL is
 * worth at the live rate. Anything else touching the faucet is refused.
 */

import { NextResponse } from "next/server";
import {
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getU32Decoder,
  getU64Decoder,
  signBytes,
  type Address,
  type ReadonlyUint8Array,
  type V0CompiledTransactionMessage,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { CLUSTER, faucetAta, faucetSigner, pins, quote, type Pin } from "@/lib/server/faucet";

/** How far the transfer may exceed a fresh quote: prices move between quote and signature. */
const TOLERANCE = 1.05;

const SYSTEM_TRANSFER = 2;
const TOKEN_TRANSFER = 3;
const TOKEN_TRANSFER_CHECKED = 12;

function u64At(data: ReadonlyUint8Array, offset: number): bigint {
  return getU64Decoder().decode(data, offset);
}

async function verify(message: V0CompiledTransactionMessage): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { address: faucet } = await faucetSigner();
  const accounts = message.staticAccounts as readonly Address[];
  const faucetIndex = accounts.indexOf(faucet);
  if (faucetIndex < 0) return { ok: false, reason: "The faucet is not in this transaction." };
  if (faucetIndex === 0) return { ok: false, reason: "The faucet cannot be the fee payer." };

  const sources = new Map<Address, Pin>();
  for (const pin of pins()) sources.set(await faucetAta(pin.mint), pin);

  let lamports: bigint | null = null;
  let sale: { mint: Address; amount: bigint } | null = null;

  for (const ix of message.instructions) {
    const program = accounts[ix.programAddressIndex];
    const indices = ix.accountIndices ?? [];
    const data = ix.data ?? new Uint8Array();
    const touchesFaucet = indices.includes(faucetIndex);

    if (program === SYSTEM_PROGRAM_ADDRESS && data.length >= 12 && getU32Decoder().decode(data) === SYSTEM_TRANSFER) {
      const [from, to] = indices;
      if (to === faucetIndex) {
        if (from !== 0) return { ok: false, reason: "SOL must come from the fee payer." };
        if (lamports !== null) return { ok: false, reason: "More than one SOL transfer." };
        lamports = u64At(data, 4);
        continue;
      }
    }

    if (program === TOKEN_PROGRAM_ADDRESS && data.length >= 9) {
      const kind = data[0];
      const authorityIndex =
        kind === TOKEN_TRANSFER ? indices[2] : kind === TOKEN_TRANSFER_CHECKED ? indices[3] : undefined;
      if (authorityIndex === faucetIndex) {
        const source = accounts[indices[0]];
        const pin = sources.get(source);
        if (!pin) return { ok: false, reason: "Not a faucet stock account." };
        if (sale !== null) return { ok: false, reason: "More than one stock transfer." };
        sale = { mint: pin.mint, amount: u64At(data, 1) };
        continue;
      }
    }

    if (touchesFaucet) return { ok: false, reason: "An unexpected instruction references the faucet." };
  }

  if (lamports === null || sale === null) return { ok: false, reason: "Missing the SOL or the stock transfer." };

  const fresh = await quote(sale.mint, lamports);
  const limit = BigInt(Math.floor(Number(fresh.stockOut) * TOLERANCE));
  if (sale.amount > limit) return { ok: false, reason: "The stock amount exceeds what the SOL is worth." };
  return { ok: true };
}

export async function POST(request: Request) {
  if (CLUSTER !== "devnet") {
    return NextResponse.json({ error: "The faucet swap only exists on devnet." }, { status: 404 });
  }

  try {
    const body = (await request.json()) as { message?: string };
    if (!body.message) return NextResponse.json({ error: "message is required." }, { status: 400 });

    const bytes = getBase64Encoder().encode(body.message);
    const message = getCompiledTransactionMessageDecoder().decode(bytes);
    if (message.version !== 0) {
      return NextResponse.json({ error: "Only version 0 transactions are signed." }, { status: 400 });
    }
    const verdict = await verify(message);
    if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 });

    const signer = await faucetSigner();
    const signature = await signBytes(signer.keyPair.privateKey, bytes);
    return NextResponse.json({ signature: getBase64Decoder().decode(signature) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
