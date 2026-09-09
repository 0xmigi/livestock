/**
 * Program upgrades through the Squads multisig that owns the program.
 *
 * One signature comes from this wallet in the terminal, the other from the
 * dashboard; either side can execute once the threshold is met.
 *
 *   MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- propose --buffer <BUFFER> [--memo "v0.1.1 <hash>"]
 *   MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- show --index <N>
 *   MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- execute --index <N>
 *
 * On chain (Squads v4) an upgrade is a vault transaction carrying the BPF
 * loader's Upgrade instruction with the vault as authority, plus a proposal
 * that members approve. `propose` creates both and casts this wallet's
 * approval in one transaction. The buffer must already belong to the vault
 * (`scripts/deploy-mainnet.sh` stages it that way).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as multisig from "@sqds/multisig";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("5X7RTCFFLgCpsRiskzm1gBEQmbzBEL39H6WpN9YzSizB");
/** The Squads v4 multisig whose vault 0 is the program's upgrade authority. */
const MULTISIG = new PublicKey("EpYZ8YDeSpMihzMSicWz4WeAjZNXfd9abEEUcM4Gzsxb");
const VAULT_INDEX = 0;
const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PRIORITY_MICROLAMPORTS = 2_000;

const { Permissions } = multisig.types;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadKeypair(): Keypair {
  const path = process.env.KEYPAIR ?? join(homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

function rpc(): Connection {
  const url = process.env.MAINNET_RPC_URL;
  if (!url) throw new Error("set MAINNET_RPC_URL to a private mainnet RPC");
  return new Connection(url, "confirmed");
}

/** Option<Pubkey> at `offset` in a BPF loader account: a tag byte then the key. */
function optionKey(data: Buffer, offset: number): PublicKey | null {
  return data[offset] === 1 ? new PublicKey(data.subarray(offset + 1, offset + 33)) : null;
}

async function send(connection: Connection, signer: Keypair, ixs: TransactionInstruction[], lookups: Parameters<TransactionMessage["compileToV0Message"]>[0] = []) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }), ...ixs],
  }).compileToV0Message(lookups);
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);
  const signature = await connection.sendTransaction(tx, { maxRetries: 5 });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

async function requireMember(connection: Connection, wallet: PublicKey, need: ReturnType<typeof Permissions.fromPermissions>) {
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, MULTISIG);
  const member = account.members.find((m) => m.key.equals(wallet));
  if (!member) throw new Error(`${wallet.toBase58()} is not a member of ${MULTISIG.toBase58()}`);
  if ((member.permissions.mask & need.mask) !== need.mask) {
    throw new Error(`${wallet.toBase58()} lacks the permission for this (mask ${member.permissions.mask})`);
  }
  return account;
}

function dashboard(): string {
  const [vault] = multisig.getVaultPda({ multisigPda: MULTISIG, index: VAULT_INDEX });
  return `https://app.squads.so/squads/${vault.toBase58()}/transactions`;
}

async function propose() {
  const buffer = arg("buffer");
  if (!buffer) throw new Error("propose needs --buffer <address>");
  const bufferKey = new PublicKey(buffer);
  const memo = arg("memo") ?? `Upgrade ${PROGRAM_ID.toBase58().slice(0, 8)} from buffer ${buffer.slice(0, 8)}`;
  const connection = rpc();
  const wallet = loadKeypair();
  const [vault] = multisig.getVaultPda({ multisigPda: MULTISIG, index: VAULT_INDEX });
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBytes()], BPF_LOADER);

  const account = await requireMember(connection, wallet.publicKey, Permissions.fromPermissions([multisig.types.Permission.Initiate, multisig.types.Permission.Vote]));

  // The vault must own both the program and the buffer, or the upgrade would fail at execution.
  const pd = await connection.getAccountInfo(programData);
  if (!pd) throw new Error("program data account not found");
  const authority = optionKey(pd.data, 12);
  if (!authority?.equals(vault)) throw new Error(`program upgrade authority is ${authority?.toBase58() ?? "none"}, not the vault ${vault.toBase58()}`);
  const buf = await connection.getAccountInfo(bufferKey);
  if (!buf || !buf.owner.equals(BPF_LOADER) || buf.data.readUInt32LE(0) !== 1) throw new Error(`${buffer} is not a BPF loader buffer`);
  const bufferAuthority = optionKey(buf.data, 4);
  if (!bufferAuthority?.equals(vault)) {
    throw new Error(`buffer authority is ${bufferAuthority?.toBase58() ?? "none"}; run: solana program set-buffer-authority ${buffer} --new-buffer-authority ${vault.toBase58()}`);
  }

  const transactionIndex = BigInt(Number(account.transactionIndex) + 1);

  // BPF loader `Upgrade`: program data, program, buffer, spill, rent, clock, authority.
  const upgrade = new TransactionInstruction({
    programId: BPF_LOADER,
    keys: [
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: true },
      { pubkey: bufferKey, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: true }, // spill: the buffer's rent comes back here
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([3, 0, 0, 0]),
  });
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: [upgrade] });

  const ixs = [
    multisig.instructions.vaultTransactionCreate({
      multisigPda: MULTISIG,
      transactionIndex,
      creator: wallet.publicKey,
      vaultIndex: VAULT_INDEX,
      ephemeralSigners: 0,
      transactionMessage: message,
      memo,
    }),
    multisig.instructions.proposalCreate({ multisigPda: MULTISIG, transactionIndex, creator: wallet.publicKey }),
    multisig.instructions.proposalApprove({ multisigPda: MULTISIG, transactionIndex, member: wallet.publicKey }),
  ];
  const signature = await send(connection, wallet, ixs);
  console.log(`proposed and approved as ${wallet.publicKey.toBase58()}`);
  console.log(`  transaction index ${transactionIndex}`);
  console.log(`  signature ${signature}`);
  console.log(`  threshold ${account.threshold}: approve and execute the rest at ${dashboard()}`);
  console.log(`  or, once approved: pnpm --filter @nm/scripts run propose-upgrade -- execute --index ${transactionIndex}`);
}

async function show() {
  const index = arg("index");
  if (!index) throw new Error("show needs --index <n>");
  const connection = rpc();
  const [proposalPda] = multisig.getProposalPda({ multisigPda: MULTISIG, transactionIndex: BigInt(index) });
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, MULTISIG);
  console.log(`proposal ${index}: ${proposal.status.__kind}`);
  console.log(`  approved by ${proposal.approved.map((k) => k.toBase58()).join(", ") || "nobody"} (threshold ${account.threshold})`);
  console.log(`  rejected by ${proposal.rejected.map((k) => k.toBase58()).join(", ") || "nobody"}`);
}

async function execute() {
  const index = arg("index");
  if (!index) throw new Error("execute needs --index <n>");
  const connection = rpc();
  const wallet = loadKeypair();
  await requireMember(connection, wallet.publicKey, Permissions.fromPermissions([multisig.types.Permission.Execute]));
  const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({
    connection,
    multisigPda: MULTISIG,
    transactionIndex: BigInt(index),
    member: wallet.publicKey,
  });
  const signature = await send(connection, wallet, [instruction], lookupTableAccounts);
  console.log(`executed proposal ${index}: ${signature}`);
}

const command = process.argv[2];
const run = { propose, show, execute }[command as "propose" | "show" | "execute"];
if (!run) {
  console.error("usage: propose-upgrade propose --buffer <address> [--memo text] | show --index <n> | execute --index <n>");
  process.exit(2);
}
run().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
