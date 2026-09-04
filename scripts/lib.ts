import * as anchor from "@coral-xyz/anchor";
import { Program, BN, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

export const PROGRAM_ID = new PublicKey(
  "5XUdp44mcYjdG4WhqYYAMAkAHcrFeKnfMWPFUdpi5rCq"
);

export const VAULT_SEED = Buffer.from("vault");
export const SEASON_SEED = Buffer.from("season");
export const NARRATIVE_MINT_SEED = Buffer.from("narrative_mint");
export const STOCK_VAULT_SEED = Buffer.from("stock_vault");
export const MARKET_MAKER_SEED = Buffer.from("market_maker");
export const CURVE_SOL_SEED = Buffer.from("curve_sol");
export const POSITION_SEED = Buffer.from("position");

export const DEFAULT_STOCK_PER_SOL = new BN(10_000_000); // 10 TSLAx (6 dp) per SOL
export const DEFAULT_FEE_BPS = 100;
export const DEFAULT_DECIMALS = 0;
export const STOCK_DECIMALS = 6;

export type SeasonVaultProgram = Program<Idl>;

export function loadIdl(): Idl {
  const candidates = [
    path.join(__dirname, "..", "idl", "season_vault.json"),
    path.join(__dirname, "..", "target", "idl", "season_vault.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as Idl;
    }
  }
  throw new Error("IDL not found. Expected idl/season_vault.json");
}

export function loadKeypair(file: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function vaultPda(stockMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, stockMint.toBuffer()],
    PROGRAM_ID
  );
}

export function stockVaultPda(stockMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STOCK_VAULT_SEED, stockMint.toBuffer()],
    PROGRAM_ID
  );
}

export function marketMakerPda(stockMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MARKET_MAKER_SEED, stockMint.toBuffer()],
    PROGRAM_ID
  );
}

export function seasonPda(
  vault: PublicKey,
  index: number
): [PublicKey, number] {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync(
    [SEASON_SEED, vault.toBuffer(), idx],
    PROGRAM_ID
  );
}

export function narrativeMintPda(
  vault: PublicKey,
  index: number
): [PublicKey, number] {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync(
    [NARRATIVE_MINT_SEED, vault.toBuffer(), idx],
    PROGRAM_ID
  );
}

export function curveSolPda(
  vault: PublicKey,
  index: number
): [PublicKey, number] {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync(
    [CURVE_SOL_SEED, vault.toBuffer(), idx],
    PROGRAM_ID
  );
}

export function positionPda(
  season: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED, season.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  );
}

export function tokenCost(
  base: bigint,
  slope: bigint,
  supply: bigint,
  amount: bigint,
  decimals: number
): bigint {
  if (amount === 0n) return 0n;
  const scale = 10n ** BigInt(decimals);
  const term1 = (amount * base) / scale;
  const span = supply * 2n + amount - 1n;
  const term2 = (slope * amount * span) / (2n * scale * scale);
  return term1 + term2;
}

export function tokensOutForSol(
  base: bigint,
  slope: bigint,
  supply: bigint,
  solIn: bigint,
  decimals: number
): bigint {
  if (solIn === 0n) return 0n;
  const scale = 10n ** BigInt(decimals);
  let hi = solIn * scale;
  if (hi === 0n) hi = solIn;
  const oneCost = tokenCost(base, slope, supply, 1n, decimals);
  if (oneCost > solIn) return 0n;
  let lo = 0n;
  while (lo < hi) {
    const mid = lo + (hi - lo + 1n) / 2n;
    const cost = tokenCost(base, slope, supply, mid, decimals);
    if (cost <= solIn) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export async function airdrop(
  connection: Connection,
  pk: PublicKey,
  lamports: number
) {
  const sig = await connection.requestAirdrop(pk, lamports);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
}

export function writeConfig(config: Record<string, string>) {
  const root = path.join(__dirname, "..");
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(config, null, 2));
  const env = [
    `NEXT_PUBLIC_PROGRAM_ID=${config.programId}`,
    `NEXT_PUBLIC_STOCK_MINT=${config.stockMint}`,
    `NEXT_PUBLIC_RPC_URL=${config.rpcUrl ?? "http://127.0.0.1:8899"}`,
    `NEXT_PUBLIC_CLUSTER=${config.cluster ?? "localnet"}`,
  ].join("\n");
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "app", ".env.local"), env + "\n");
}

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, SystemProgram, SYSVAR_RENT_PUBKEY, BN, anchor };
