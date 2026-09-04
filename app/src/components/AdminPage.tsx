"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";
import {
  dummyProvider,
  getProgram,
  marketMakerPda,
  narrativeMintPda,
  curveSolPda,
  seasonPda,
  stockVaultPda,
  vaultPda,
} from "@/lib/program";
import { pushActivity } from "@/lib/activity";

// re-export constant used only here
const STOCK_PER_SOL = new BN(10_000_000);
const FEE_BPS = 100;

const DURATIONS: { label: string; secs: number }[] = [
  { label: "10 minutes", secs: 600 },
  { label: "1 hour", secs: 3600 },
  { label: "1 day", secs: 86400 },
];

export function AdminPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [stockMint, setStockMint] = useState(
    process.env.NEXT_PUBLIC_STOCK_MINT ?? ""
  );
  const [name, setName] = useState("Robotaxi");
  const [duration, setDuration] = useState(600);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [vaultInfo, setVaultInfo] = useState<string>("");

  const note = (s: string) => setLog((prev) => [s, ...prev].slice(0, 30));

  const refresh = useCallback(async () => {
    if (!stockMint) return;
    try {
      const mint = new PublicKey(stockMint);
      const [v] = vaultPda(mint);
      const program = getProgram(dummyProvider(connection));
      const acc = await program.account.vault.fetch(v);
      setVaultInfo(
        `vault ${v.toBase58().slice(0, 8)}… · seasonIndex ${acc.seasonIndex} · live ${
          (acc.liveSeason as PublicKey).equals(PublicKey.default)
            ? "none"
            : (acc.liveSeason as PublicKey).toBase58().slice(0, 8) + "…"
        }`
      );
    } catch {
      setVaultInfo("vault not initialized");
    }
  }, [connection, stockMint]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function provider() {
    return new AnchorProvider(connection, wallet as never, {
      commitment: "confirmed",
    });
  }

  async function createMockMint() {
    if (!wallet.publicKey || !wallet.sendTransaction) return;
    setBusy(true);
    try {
      // Wallet-based mint creation needs the wallet to sign. Use a throwaway
      // mint keypair and have the connected wallet pay.
      const mintKp = Keypair.generate();
      const mint = await createMint(
        connection,
        // @solana/spl-token expects a Signer payer. On localnet admin scripts
        // are preferred; this path is a convenience for Phantom.
        {
          publicKey: wallet.publicKey,
          secretKey: new Uint8Array(),
        } as never,
        wallet.publicKey,
        null,
        6,
        mintKp
      );
      setStockMint(mint.toBase58());
      note(`Created TSLAx mint ${mint.toBase58()}`);
    } catch (e: unknown) {
      note(
        "Mint via wallet failed (expected). Run `npm run setup` on localnet, or paste an existing mint."
      );
      note(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function initVault() {
    if (!wallet.publicKey) return;
    setBusy(true);
    try {
      const mint = new PublicKey(stockMint);
      const program = getProgram(provider());
      const [vault] = vaultPda(mint);
      const [stockVault] = stockVaultPda(mint);
      const [mm] = marketMakerPda(mint);
      const sig = await program.methods
        .initVault(STOCK_PER_SOL)
        .accounts({
          authority: wallet.publicKey,
          stockMint: mint,
          vault,
          stockVaultAta: stockVault,
          marketMakerAta: mm,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      pushActivity("init_vault", sig);
      note(`init_vault ${sig}`);
      await refresh();
    } catch (e: unknown) {
      note(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createSeason() {
    if (!wallet.publicKey) return;
    setBusy(true);
    try {
      const mint = new PublicKey(stockMint);
      const program = getProgram(provider());
      const [vault] = vaultPda(mint);
      const acc = await program.account.vault.fetch(vault);
      const index = acc.seasonIndex as number;
      const [season] = seasonPda(vault, index);
      const [narrativeMint] = narrativeMintPda(vault, index);
      const [curveSol] = curveSolPda(vault, index);
      const sig = await program.methods
        .createSeason(name, new BN(duration), FEE_BPS, 0)
        .accounts({
          authority: wallet.publicKey,
          vault,
          season,
          narrativeMint,
          curveSolVault: curveSol,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      pushActivity("create_season", sig);
      note(`create_season ${name} ${sig}`);
      await refresh();
    } catch (e: unknown) {
      note(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function closeSeason() {
    if (!wallet.publicKey) return;
    setBusy(true);
    try {
      const mint = new PublicKey(stockMint);
      const program = getProgram(provider());
      const [vault] = vaultPda(mint);
      const acc = await program.account.vault.fetch(vault);
      const live = acc.liveSeason as PublicKey;
      if (live.equals(PublicKey.default)) throw new Error("no live season");
      const s = await program.account.season.fetch(live);
      const sig = await program.methods
        .closeSeason()
        .accounts({
          caller: wallet.publicKey,
          vault,
          season: live,
          stockVaultAta: stockVaultPda(mint)[0],
          narrativeMint: s.narrativeMint as PublicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      pushActivity("close_season", sig);
      note(`close_season ${sig}`);
      await refresh();
    } catch (e: unknown) {
      note(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fundMm() {
    if (!wallet.publicKey) return;
    setBusy(true);
    try {
      const mint = new PublicKey(stockMint);
      const [mm] = marketMakerPda(mint);
      const from = await getOrCreateAssociatedTokenAccount(
        connection,
        { publicKey: wallet.publicKey, secretKey: new Uint8Array() } as never,
        mint,
        wallet.publicKey
      );
      const sig = await transfer(
        connection,
        { publicKey: wallet.publicKey, secretKey: new Uint8Array() } as never,
        from.address,
        mm,
        wallet.publicKey,
        100_000n * 1_000_000n
      );
      note(`funded MM ${sig}`);
    } catch (e: unknown) {
      note(
        "Fund MM from this UI needs a wallet that can sign SPL transfer. Prefer `npm run setup` or Phantom with TSLAx in wallet."
      );
      note(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">Localnet admin</p>
      <h1 className="mt-2 font-serif text-4xl text-paper">Booth</h1>
      <p className="mt-2 text-sm text-mute">
        Ungated on purpose. Create the mock TSLAx vault, open Robotaxi, close, then
        FSD.
      </p>
      <p className="mt-2 font-mono text-xs text-mute">{vaultInfo}</p>

      <label className="mt-8 block text-xs uppercase text-mute">Stock mint</label>
      <input
        className="mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 font-mono text-sm text-paper"
        value={stockMint}
        onChange={(e) => setStockMint(e.target.value)}
        placeholder="TSLAx mint address"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={initVault}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm text-paper"
        >
          Create vault
        </button>
        <button
          disabled={busy}
          onClick={closeSeason}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm text-paper"
        >
          Close season
        </button>
        <button
          disabled={busy}
          onClick={fundMm}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm text-paper"
        >
          Fund MM 100k
        </button>
      </div>

      <div className="mt-8 rounded-2xl border border-white/10 p-4">
        <h2 className="font-serif text-lg">Create season</h2>
        <input
          className="mt-3 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 font-mono text-sm text-paper"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-paper"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        >
          {DURATIONS.map((d) => (
            <option key={d.secs} value={d.secs}>
              {d.label}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !wallet.connected}
          onClick={createSeason}
          className="mt-3 w-full rounded-lg bg-gold px-4 py-2 font-medium text-ink"
        >
          Open season
        </button>
      </div>

      <p className="mt-6 text-xs text-mute">
        Demo inventory is easiest via <code className="font-mono">npm run setup</code>{" "}
        against <code className="font-mono">solana-test-validator</code>. Phantom must
        point at localnet.
      </p>

      <ul className="mt-6 space-y-1 font-mono text-xs text-mute">
        {log.map((l, i) => (
          <li key={i} className="break-all">
            {l}
          </li>
        ))}
      </ul>
    </main>
  );
}
