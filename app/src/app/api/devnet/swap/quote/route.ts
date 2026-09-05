/**
 * Quotes the devnet swap leg: how much stand-in stock this many lamports buys,
 * and where to send them. See src/lib/server/faucet.ts.
 */

import { NextResponse } from "next/server";
import { address } from "@solana/kit";

import { CLUSTER, faucetAta, faucetSigner, quote } from "@/lib/server/faucet";

export async function POST(request: Request) {
  if (CLUSTER !== "devnet") {
    return NextResponse.json({ error: "The faucet swap only exists on devnet." }, { status: 404 });
  }

  try {
    const body = (await request.json()) as { stockMint?: string; lamports?: string };
    if (!body.stockMint || !body.lamports) {
      return NextResponse.json({ error: "stockMint and lamports are required." }, { status: 400 });
    }
    const lamports = BigInt(body.lamports);
    if (lamports <= 0n) {
      return NextResponse.json({ error: "lamports must be positive." }, { status: 400 });
    }

    const stockMint = address(body.stockMint);
    const [q, signer, source] = await Promise.all([
      quote(stockMint, lamports),
      faucetSigner(),
      faucetAta(stockMint),
    ]);

    return NextResponse.json({
      stockOut: q.stockOut.toString(),
      decimals: q.pin.decimals,
      symbol: q.pin.symbol,
      faucet: signer.address,
      faucetAta: source,
      solUsd: q.solUsd,
      stockUsd: q.stockUsd,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
