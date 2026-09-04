import type { Idl } from "@coral-xyz/anchor";
import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idlJson from "@/idl/season_vault.json";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "5XUdp44mcYjdG4WhqYYAMAkAHcrFeKnfMWPFUdpi5rCq"
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";

export const STOCK_MINT = process.env.NEXT_PUBLIC_STOCK_MINT
  ? new PublicKey(process.env.NEXT_PUBLIC_STOCK_MINT)
  : null;

export const IDL = idlJson as Idl;

export const TOKEN = TOKEN_PROGRAM_ID;
export const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;

export function getConnection() {
  return new Connection(RPC_URL, "confirmed");
}

export function vaultPda(stockMint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), stockMint.toBuffer()],
    PROGRAM_ID
  );
}

export function stockVaultPda(stockMint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stock_vault"), stockMint.toBuffer()],
    PROGRAM_ID
  );
}

export function marketMakerPda(stockMint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market_maker"), stockMint.toBuffer()],
    PROGRAM_ID
  );
}

export function seasonPda(vault: PublicKey, index: number) {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("season"), vault.toBuffer(), idx],
    PROGRAM_ID
  );
}

export function narrativeMintPda(vault: PublicKey, index: number) {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("narrative_mint"), vault.toBuffer(), idx],
    PROGRAM_ID
  );
}

export function curveSolPda(vault: PublicKey, index: number) {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve_sol"), vault.toBuffer(), idx],
    PROGRAM_ID
  );
}

export function positionPda(season: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), season.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  );
}

export function getProgram(provider: AnchorProvider) {
  return new Program(IDL, provider);
}

type AccountFetcher<T> = { fetch: (pk: PublicKey) => Promise<T> };

export type VaultAccount = {
  authority: PublicKey;
  stockMint: PublicKey;
  stockVaultAta: PublicKey;
  marketMakerAta: PublicKey;
  liveSeason: PublicKey;
  seasonIndex: number;
  totalStock: { toString: () => string };
  pendingClaims: { toString: () => string };
  stockPerSol: { toString: () => string };
  bump: number;
};

export type SeasonAccount = {
  vault: PublicKey;
  index: number;
  name: string;
  narrativeMint: PublicKey;
  startTs: { toString: () => string };
  endTs: { toString: () => string } | number;
  status: Record<string, unknown>;
  curveSolVault: PublicKey;
  stockBought: { toString: () => string };
  narrativeSupply: { toString: () => string };
  feeBps: number;
  base: { toString: () => string };
  slope: { toString: () => string };
  decimals: number;
  redeemableStock: { toString: () => string };
  redeemableSupply: { toString: () => string };
  remainingStock: { toString: () => string };
  remainingSupply: { toString: () => string };
  solReserve: { toString: () => string };
  bump: number;
};

export function vaultClient(program: Program) {
  return (program.account as unknown as { vault: AccountFetcher<VaultAccount> })
    .vault;
}

export function seasonClient(program: Program) {
  return (
    program.account as unknown as { season: AccountFetcher<SeasonAccount> }
  ).season;
}

export function toNum(x: { toString: () => string } | number): number {
  return typeof x === "number" ? x : Number(x.toString());
}

export function dummyProvider(connection: Connection) {
  return new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    { commitment: "confirmed" }
  );
}

export { BN, SystemProgram, clusterApiUrl, getAssociatedTokenAddressSync };
