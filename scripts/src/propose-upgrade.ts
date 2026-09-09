/**
 * Program upgrades through the Squads multisig that owns the program.
 *
 * One signature comes from this wallet in the terminal, the other from the
 * dashboard; either side can execute once the threshold is met.
 *
 *   MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- propose --buffer <BUFFER> [--memo "v0.1.1 <hash>"]
 *   MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- show --index <N>
 *   MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- execute --index <N>
 *   MAINNET_RPC_URL=... pnpm --filter @nm/scripts run propose-upgrade -- propose-tx --tx <file.b64> [--tx <file.b64>...] [--memo text]
 *
 * `propose-tx` wraps any transaction exported with the vault as its signer
 * (e.g. `program-metadata ... --export <vault>`) into one vault transaction,
 * so the multisig can run instructions of other programs too.
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
import { readFileSync as readFile } from "node:fs";

const PROGRAM_ID = new PublicKey("5X7RTCFFLgCpsRiskzm1gBEQmbzBEL39H6WpN9YzSizB");
/** The Squads v4 multisig whose vault 0 is the program's upgrade authority. */
const MULTISIG = new PublicKey("EpYZ8YDeSpMihzMSicWz4WeAjZNXfd9abEEUcM4Gzsxb");
const VAULT_INDEX = 0;
const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PRIORITY_MICROLAMPORTS = 2_000;

const { Permissions } = multisig.types;

// pnpm forwards a literal "--" ahead of the script's own arguments; drop it.
const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
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

  await proposeMessage(connection, wallet, account, transactionIndex, message, memo);
}

/** Creates the vault transaction and its proposal, and casts this wallet's approval, in one transaction. */
async function proposeMessage(
  connection: Connection,
  wallet: Keypair,
  account: Awaited<ReturnType<typeof multisig.accounts.Multisig.fromAccountAddress>>,
  transactionIndex: bigint,
  message: TransactionMessage,
  memo: string,
) {
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

/** Every `--tx <file>` on the command line. */
function txFiles(): string[] {
  return argv.flatMap((a, i) => (a === "--tx" && argv[i + 1] ? [argv[i + 1]] : []));
}

async function proposeTx() {
  const files = txFiles();
  if (files.length === 0) throw new Error("propose-tx needs at least one --tx <base64 file>");
  const connection = rpc();
  const wallet = loadKeypair();
  const [vault] = multisig.getVaultPda({ multisigPda: MULTISIG, index: VAULT_INDEX });

  // Unpack each exported transaction back into instructions. Exports carry no
  // lookup tables, so every account is in the static key list.
  const instructions: TransactionInstruction[] = [];
  for (const file of files) {
    const raw = readFile(file, "utf8").trim();
    const tx = VersionedTransaction.deserialize(Buffer.from(raw, "base64"));
    const msg = tx.message;
    if (msg.addressTableLookups.length > 0) throw new Error(`${file} uses lookup tables; not supported`);
    const keys = msg.staticAccountKeys;
    for (const ci of msg.compiledInstructions) {
      const programId = keys[ci.programIdIndex];
      if (programId.equals(ComputeBudgetProgram.programId)) continue; // the vault does not pay priority fees
      instructions.push(
        new TransactionInstruction({
          programId,
          keys: ci.accountKeyIndexes.map((k) => ({
            pubkey: keys[k],
            isSigner: msg.isAccountSigner(k),
            isWritable: msg.isAccountWritable(k),
          })),
          data: Buffer.from(ci.data),
        }),
      );
    }
  }
  const signers = new Set(instructions.flatMap((ix) => ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())));
  for (const s of signers) {
    if (s !== vault.toBase58()) throw new Error(`instruction needs signer ${s}; only the vault ${vault.toBase58()} can sign here`);
  }

  const account = await requireMember(connection, wallet.publicKey, Permissions.fromPermissions([multisig.types.Permission.Initiate, multisig.types.Permission.Vote]));
  const transactionIndex = BigInt(Number(account.transactionIndex) + 1);
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions });
  const memo = arg("memo") ?? `${instructions.length} instruction(s) from ${files.map((f) => f.split("/").pop()).join(", ")}`;
  console.log(`${instructions.length} instruction(s), programs: ${[...new Set(instructions.map((ix) => ix.programId.toBase58()))].join(", ")}`);
  await proposeMessage(connection, wallet, account, transactionIndex, message, memo);
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

const command = argv[0];
const run = { propose, "propose-tx": proposeTx, show, execute }[command as "propose" | "propose-tx" | "show" | "execute"];
if (!run) {
  console.error("usage: propose-upgrade propose --buffer <address> [--memo text] | propose-tx --tx <file.b64>... [--memo text] | show --index <n> | execute --index <n>");
  process.exit(2);
}
run().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
