/**
 * Demo loop:
 *  1. Wallet A buys 1 SOL
 *  2. Wallet B buys 2 SOL
 *  3. Admin closes the season
 *  4. Wallet A redeems
 *  5. Admin creates season 2 "FSD"
 *  6. Wallet B rolls
 *  7. Assert A received stock, B holds season-2 tokens, vault still holds B's claim
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_FEE_BPS,
  PROGRAM_ID,
  curveSolPda,
  loadIdl,
  loadKeypair,
  narrativeMintPda,
  positionPda,
  seasonPda,
  stockVaultPda,
  vaultPda,
} from "./lib";

function mustConfig(): Record<string, string> {
  const p = path.join(__dirname, "..", "config.json");
  if (!fs.existsSync(p)) {
    throw new Error("Run `npm run setup` first (needs a running local validator).");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const cfg = mustConfig();
  const connection = new Connection(cfg.rpcUrl ?? "http://127.0.0.1:8899", "confirmed");
  const admin = loadKeypair(
    process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json")
  );
  const walletA = loadKeypair(path.join(__dirname, "..", "keys", "wallet-a.json"));
  const walletB = loadKeypair(path.join(__dirname, "..", "keys", "wallet-b.json"));

  const stockMint = new PublicKey(cfg.stockMint);
  const [vault] = vaultPda(stockMint);
  const [stockVault] = stockVaultPda(stockMint);
  const [season0] = seasonPda(vault, 0);
  const [narrative0] = narrativeMintPda(vault, 0);
  const [curve0] = curveSolPda(vault, 0);

  const idl = loadIdl();
  const makeProgram = (kp: Keypair) =>
    new anchor.Program(
      idl,
      new anchor.AnchorProvider(connection, new anchor.Wallet(kp), {
        commitment: "confirmed",
      })
    );

  const buy = async (buyer: Keypair, sol: number) => {
    const program = makeProgram(buyer);
    const ata = getAssociatedTokenAddressSync(narrative0, buyer.publicKey);
    await program.methods
      .buy(new BN(sol * LAMPORTS_PER_SOL))
      .accounts({
        buyer: buyer.publicKey,
        vault,
        season: season0,
        narrativeMint: narrative0,
        buyerNarrativeAta: ata,
        stockMint,
        stockVaultAta: stockVault,
        marketMakerAta: new PublicKey(cfg.marketMaker),
        curveSolVault: curve0,
        feeRecipient: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };

  console.log("Wallet A buys 1 SOL…");
  await buy(walletA, 1);
  console.log("Wallet B buys 2 SOL…");
  await buy(walletB, 2);

  const vaultBeforeClose = await getAccount(connection, stockVault);
  console.log("Vault stock after buys:", Number(vaultBeforeClose.amount) / 1e6, "TSLAx");

  console.log("Admin close_season…");
  await makeProgram(admin)
    .methods.closeSeason()
    .accounts({
      caller: admin.publicKey,
      vault,
      season: season0,
      stockVaultAta: stockVault,
      narrativeMint: narrative0,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  const aNarrativeAta = getAssociatedTokenAddressSync(narrative0, walletA.publicKey);
  const aStockAta = getAssociatedTokenAddressSync(stockMint, walletA.publicKey);
  const [aPos] = positionPda(season0, walletA.publicKey);

  console.log("Wallet A redeem…");
  await makeProgram(walletA)
    .methods.redeem()
    .accounts({
      owner: walletA.publicKey,
      vault,
      season: season0,
      position: aPos,
      narrativeMint: narrative0,
      ownerNarrativeAta: aNarrativeAta,
      stockMint,
      stockVaultAta: stockVault,
      ownerStockAta: aStockAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const aStock = await getAccount(connection, aStockAta);
  console.log("A TSLAx after redeem:", Number(aStock.amount) / 1e6);

  const [season1] = seasonPda(vault, 1);
  const [narrative1] = narrativeMintPda(vault, 1);
  const [curve1] = curveSolPda(vault, 1);

  console.log('Admin create_season("FSD")…');
  await makeProgram(admin)
    .methods.createSeason("FSD", new BN(600), DEFAULT_FEE_BPS, 0)
    .accounts({
      authority: admin.publicKey,
      vault,
      season: season1,
      narrativeMint: narrative1,
      curveSolVault: curve1,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const bOldAta = getAssociatedTokenAddressSync(narrative0, walletB.publicKey);
  const bNewAta = getAssociatedTokenAddressSync(narrative1, walletB.publicKey);
  const [bPos] = positionPda(season0, walletB.publicKey);

  console.log("Wallet B roll…");
  await makeProgram(walletB)
    .methods.roll()
    .accounts({
      owner: walletB.publicKey,
      vault,
      season: season0,
      nextSeason: season1,
      position: bPos,
      narrativeMint: narrative0,
      nextNarrativeMint: narrative1,
      ownerNarrativeAta: bOldAta,
      ownerNextNarrativeAta: bNewAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const bNew = await getAccount(connection, bNewAta);
  const vaultAfter = await getAccount(connection, stockVault);

  if (aStock.amount === 0n) {
    throw new Error("Expected A to receive TSLAx on redeem");
  }
  if (bNew.amount === 0n) {
    throw new Error("Expected B to hold season-2 narrative tokens");
  }
  if (vaultAfter.amount === 0n) {
    throw new Error("Expected vault to still hold B's stock claim");
  }

  console.log("\n=== Demo assertions passed ===");
  console.log("A TSLAx (redeemed):     ", Number(aStock.amount) / 1e6);
  console.log("B season-2 tokens:      ", bNew.amount.toString());
  console.log("Vault remaining TSLAx:  ", Number(vaultAfter.amount) / 1e6);
  console.log("Program:                ", PROGRAM_ID.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
