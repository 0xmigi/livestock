/**
 * Localnet bootstrap:
 *  1. Airdrop admin + two test wallets
 *  2. Create mock TSLAx mint and mint 1_000_000 tokens to admin
 *  3. init_vault
 *  4. Fund market-maker ATA with 100_000 mock stock
 *  5. create_season("Robotaxi", 600)
 *  6. Print PDAs and write config.json + app/.env.local
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
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
} from "@solana/spl-token";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_FEE_BPS,
  DEFAULT_STOCK_PER_SOL,
  PROGRAM_ID,
  airdrop,
  curveSolPda,
  loadIdl,
  loadKeypair,
  marketMakerPda,
  narrativeMintPda,
  seasonPda,
  stockVaultPda,
  vaultPda,
  writeConfig,
} from "./lib";

async function main() {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8899";
  const connection = new Connection(rpc, "confirmed");
  const admin = loadKeypair(
    process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json")
  );

  const walletA = Keypair.generate();
  const walletB = Keypair.generate();
  fs.writeFileSync(
    path.join(__dirname, "..", "keys", "wallet-a.json"),
    JSON.stringify(Array.from(walletA.secretKey))
  );
  fs.writeFileSync(
    path.join(__dirname, "..", "keys", "wallet-b.json"),
    JSON.stringify(Array.from(walletB.secretKey))
  );

  console.log("Airdropping SOL…");
  for (const kp of [admin, walletA, walletB]) {
    await airdrop(connection, kp.publicKey, 50 * LAMPORTS_PER_SOL);
  }

  console.log("Creating mock TSLAx mint…");
  const stockMint = await createMint(
    connection,
    admin,
    admin.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  const adminStock = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    stockMint,
    admin.publicKey
  );
  const million = 1_000_000n * 1_000_000n; // 1_000_000 tokens, 6 decimals
  await mintTo(
    connection,
    admin,
    stockMint,
    adminStock.address,
    admin,
    million
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(admin),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const idl = loadIdl();
  const program = new anchor.Program(idl, provider);

  const [vault] = vaultPda(stockMint);
  const [stockVault] = stockVaultPda(stockMint);
  const [marketMaker] = marketMakerPda(stockMint);

  console.log("init_vault…");
  await program.methods
    .initVault(DEFAULT_STOCK_PER_SOL)
    .accounts({
      authority: admin.publicKey,
      stockMint,
      vault,
      stockVaultAta: stockVault,
      marketMakerAta: marketMaker,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Funding market-maker ATA with 100_000 TSLAx…");
  await transfer(
    connection,
    admin,
    adminStock.address,
    marketMaker,
    admin,
    100_000n * 1_000_000n
  );

  const index = 0;
  const [season] = seasonPda(vault, index);
  const [narrativeMint] = narrativeMintPda(vault, index);
  const [curveSol] = curveSolPda(vault, index);

  console.log('create_season("Robotaxi", 600)…');
  await program.methods
    .createSeason("Robotaxi", new BN(600), DEFAULT_FEE_BPS, 0)
    .accounts({
      authority: admin.publicKey,
      vault,
      season,
      narrativeMint,
      curveSolVault: curveSol,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const config = {
    programId: PROGRAM_ID.toBase58(),
    stockMint: stockMint.toBase58(),
    vault: vault.toBase58(),
    stockVault: stockVault.toBase58(),
    marketMaker: marketMaker.toBase58(),
    season0: season.toBase58(),
    narrativeMint0: narrativeMint.toBase58(),
    curveSol0: curveSol.toBase58(),
    admin: admin.publicKey.toBase58(),
    walletA: walletA.publicKey.toBase58(),
    walletB: walletB.publicKey.toBase58(),
    rpcUrl: rpc,
    cluster: "localnet",
  };
  writeConfig(config);

  console.log("\n=== Season Vault localnet ===");
  for (const [k, v] of Object.entries(config)) {
    console.log(`${k.padEnd(16)} ${v}`);
  }
  console.log("\nWrote config.json and app/.env.local");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
