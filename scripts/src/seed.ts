/**
 * Seeds a cluster with narratives so the app has something to show.
 *
 * A development tool, not part of the product. Reads the deployer keypair from
 * the Solana CLI config and the stock mint from the environment.
 *
 *   RPC_URL=... STOCK_MINT=... pnpm --filter @nm/scripts run seed
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buyCost,
  applyBps,
  findNarrative,
  findNarrativeMint,
  findVault,
  formatStock,
  getBuyInstruction,
  getCreateNarrativeInstruction,
  usdToStock,
} from "@nm/client";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
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
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.WS_URL ?? "wss://api.devnet.solana.com";
const STOCK_DECIMALS = 8;
const STOCK_PRICE_USD = Number(process.env.STOCK_PRICE_USD ?? 250);

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

async function loadCliSigner(): Promise<KeyPairSigner> {
  const path =
    process.env.KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  const secret = new Uint8Array(
    JSON.parse(readFileSync(path, "utf8")) as number[],
  );
  return createKeyPairSignerFromBytes(secret);
}

async function ata(mint: Address, owner: Address): Promise<Address> {
  const [pda] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return pda;
}

const NARRATIVES = [
  { name: "Robotaxi Austin", symbol: "RBTX", days: 14, buy: 400 },
  { name: "FSD v14", symbol: "FSD", days: 7, buy: 150 },
  { name: "Optimus Preorders", symbol: "OPTI", days: 30, buy: 0 },
];

async function main(): Promise<void> {
  const stockMintRaw = process.env.STOCK_MINT;
  if (!stockMintRaw) throw new Error("set STOCK_MINT");
  const stockMint = address(stockMintRaw);

  const signer = await loadCliSigner();
  console.log(`\nRPC        ${RPC_URL}`);
  console.log(`creator    ${signer.address}`);
  console.log(`stock      ${stockMint}\n`);

  const basePrice = usdToStock(0.1, STOCK_PRICE_USD, STOCK_DECIMALS);
  const slope =
    (usdToStock(10, STOCK_PRICE_USD, STOCK_DECIMALS) - basePrice) / 1_000_000n;

  for (const spec of NARRATIVES) {
    const [narrative] = await findNarrative(stockMint, signer.address, spec.name);
    const [narrativeMint] = await findNarrativeMint(narrative);
    const [vault] = await findVault(narrative);

    const existing = await rpc.getAccountInfo(narrative).send();
    if (existing.value) {
      console.log(`· ${spec.name} already exists — ${narrative}`);
      continue;
    }

    const expiryTs = BigInt(
      Math.floor(Date.now() / 1000) + spec.days * 24 * 3600,
    );

    await send(signer, [
      getCreateNarrativeInstruction({
        creator: signer.address,
        narrative,
        stockMint,
        narrativeMint,
        vault,
        name: spec.name,
        symbol: spec.symbol,
        expiryTs,
        basePrice,
        slope,
        feeBps: 100,
        sellTaxBps: 1_000,
      }),
    ]);
    console.log(`✓ ${spec.name} (${spec.symbol}) — ${narrative}`);

    if (spec.buy > 0) {
      const tokens = BigInt(spec.buy);
      const cost = buyCost(0n, tokens, { basePrice, slope });
      const total = cost + applyBps(cost, 100);

      const stockAta = await ata(stockMint, signer.address);
      const tokenAta = await ata(narrativeMint, signer.address);
      const creatorFee = await ata(stockMint, signer.address);

      await send(signer, [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: tokenAta,
          owner: signer.address,
          mint: narrativeMint,
        }),
        getBuyInstruction({
          buyer: signer.address,
          narrative,
          narrativeMint,
          buyerTokenAccount: tokenAta,
          buyerStockAccount: stockAta,
          vault,
          creatorFeeAccount: creatorFee,
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
