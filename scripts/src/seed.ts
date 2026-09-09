/**
 * Seeds a cluster with narratives so the app has something to show.
 *
 * A development tool, not part of the product. Reads the deployer keypair from
 * the Solana CLI config and the stock mint from the environment.
 *
 *   RPC_URL=... STOCK_MINT=... pnpm --filter @nm/scripts run seed
 *
 * HOURS=1 seeds a single short-lived narrative instead, so the expire and
 * redeem paths can be exercised on a live cluster without waiting a week
 * (the program's minimum duration is one hour).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buyCost,
  applyBps,
  findNarrative,
  findVault,
  formatStock,
  getBuyInstruction,
  getCreateNarrativeInstruction,
  getCreateNarrativeMintInstructions,
  getNarrativeMintSize,
  initialVirtualStock,
  openingState,
} from "@nm/client";
import { findTreasuryStockAccount, PROTOCOL_FEE_BPS, TREASURY } from "@nm/client";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.WS_URL ?? "wss://api.devnet.solana.com";
const STOCK_DECIMALS = 8;
const STOCK_PRICE_USD = Number(process.env.STOCK_PRICE_USD ?? 250);
const SOL_PRICE_USD = Number(process.env.SOL_PRICE_USD ?? 150);

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions,
});

async function send(
  payer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
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

/** Strips API keys out of an RPC URL before it reaches a log or a screen. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret/i.test(key)) parsed.searchParams.set(key, "…");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

async function loadCliSigner(): Promise<KeyPairSigner> {
  const path =
    process.env.KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  const secret = new Uint8Array(
    JSON.parse(readFileSync(path, "utf8")) as number[],
  );
  return createKeyPairSignerFromBytes(secret);
}

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

/**
 * Seeded mints get a placeholder metadata URI — the app's upload route is what
 * produces real ones, and a dev seed has no image to upload.
 */
const METADATA_URI =
  process.env.METADATA_URI ?? "https://example.invalid/narrative.json";

const HOURS = Number(process.env.HOURS ?? 0);

const NARRATIVES =
  HOURS > 0
    ? [{ name: "Lifecycle test", symbol: "LIFE", hours: HOURS, buy: 25_000_000 }]
    : [
        { name: "Robotaxi Austin", symbol: "RBTX", hours: 14 * 24, buy: 40_000_000 },
        { name: "FSD v14", symbol: "FSD", hours: 7 * 24, buy: 15_000_000 },
        { name: "Optimus Preorders", symbol: "OPTI", hours: 30 * 24, buy: 0 },
      ];

async function main(): Promise<void> {
  const stockMintRaw = process.env.STOCK_MINT;
  if (!stockMintRaw) throw new Error("set STOCK_MINT");
  const stockMint = address(stockMintRaw);

  const signer = await loadCliSigner();
  console.log(`\nRPC        ${redact(RPC_URL)}`);
  console.log(`creator    ${signer.address}`);
  console.log(`stock      ${stockMint}\n`);

  const stockTokenProgram = await stockTokenProgramOf(stockMint);
  console.log(`token prog  ${stockTokenProgram}\n`);

  // The curve's one parameter: 30 SOL in the stock, pump.fun's opening
  // virtual liquidity.
  const virtualStock = initialVirtualStock(SOL_PRICE_USD, STOCK_PRICE_USD, STOCK_DECIMALS);

  for (const spec of NARRATIVES) {
    // The mint is a keypair now, so a fresh one is generated per narrative and
    // the narrative address hangs off it.
    const mint = await generateKeyPairSigner();
    const [narrative] = await findNarrative(mint.address);
    const narrativeMint = mint.address;
    const [vault] = await findVault(narrative, stockMint, stockTokenProgram);

    const expiryTs = BigInt(
      Math.floor(Date.now() / 1000) + Math.round(spec.hours * 3600),
    );

    const { fundFor } = getNarrativeMintSize(
      spec.name,
      spec.symbol,
      METADATA_URI,
    );
    const lamports = await rpc
      .getMinimumBalanceForRentExemption(BigInt(fundFor))
      .send();

    await send(signer, [
      ...getCreateNarrativeMintInstructions({
        payer: signer,
        mint,
        narrative,
        name: spec.name,
        symbol: spec.symbol,
        uri: METADATA_URI,
        lamports,
      }),
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        ata: vault,
        owner: narrative,
        mint: stockMint,
        tokenProgram: stockTokenProgram,
      }),
      getCreateNarrativeInstruction({
        creator: signer.address,
        narrative,
        stockMint,
        narrativeMint,
        vault,
        stockTokenProgram,
        name: spec.name,
        symbol: spec.symbol,
        expiryTs,
        virtualStock,
        feeBps: 100,
        sellTaxBps: 1_000,
      }),
    ]);
    console.log(`✓ ${spec.name} (${spec.symbol}) — ${narrative}`);

    if (spec.buy > 0) {
      const tokens = BigInt(spec.buy);
      const cost = buyCost(openingState(virtualStock), tokens);
      const total = cost + applyBps(cost, 100) + applyBps(cost, PROTOCOL_FEE_BPS);

      const stockAta = await ata(stockMint, signer.address, stockTokenProgram);
      const tokenAta = await ata(
        narrativeMint,
        signer.address,
        TOKEN_2022_PROGRAM_ADDRESS,
      );
      const creatorFee = stockAta;
      const [treasury] = await findTreasuryStockAccount(stockMint, stockTokenProgram);

      await send(signer, [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: tokenAta,
          owner: signer.address,
          mint: narrativeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: treasury,
          owner: TREASURY,
          mint: stockMint,
          tokenProgram: stockTokenProgram,
        }),
        getBuyInstruction({
          buyer: signer.address,
          narrative,
          narrativeMint,
          buyerTokenAccount: tokenAta,
          buyerStockAccount: stockAta,
          vault,
          creatorFeeAccount: creatorFee,
          treasuryStockAccount: treasury,
          stockMint,
          stockTokenProgram,
          tokensOut: tokens,
          maxStockIn: total,
        }),
      ]);
      console.log(
        `  bought ${tokens} for ${formatStock(total, STOCK_DECIMALS)} stock`,
      );
    }
  }

  console.log("\nDone.\n");
}

main().catch((error) => {
  console.error("\nSeed failed:", error);
  process.exit(1);
});
