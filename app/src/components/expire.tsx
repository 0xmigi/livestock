"use client";

/**
 * Settling an expired narrative.
 *
 * `expire` is permissionless once the date has passed and takes no signer of
 * its own: anyone can settle any narrative. Whoever clicks this pays the fee
 * and unlocks redemption for every holder.
 */

import { useState } from "react";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { findTreasuryStockAccount, getExpireInstruction, TREASURY } from "@nm/client";
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token-2022";
import { createNoopSigner, type Address } from "@solana/kit";

import { SOLANA_CHAIN } from "@/lib/config";
import type { NarrativeRow } from "@/lib/narratives";
import { signAndSend, toUserMessage } from "@/lib/tx";
import { Button, Notice } from "./ui";

export function ExpireButton({
  narrative,
  owner,
  onDone,
  quiet = false,
}: {
  narrative: NarrativeRow;
  owner: Address;
  onDone: () => void;
  /** When the keeper is expected to settle: offer it as a fallback, not the main action. */
  quiet?: boolean;
}) {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = async () => {
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) {
      setError("No Solana wallet connected.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      // The conversion fee lands in the treasury's account for this stock; make sure it exists.
      const [treasury] = await findTreasuryStockAccount(narrative.stockMint, narrative.stockTokenProgram);
      await signAndSend(
        owner,
        [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(owner),
            ata: treasury,
            owner: TREASURY,
            mint: narrative.stockMint,
            tokenProgram: narrative.stockTokenProgram,
          }),
          getExpireInstruction({
            narrative: narrative.address,
            narrativeMint: narrative.narrativeMint,
            vault: narrative.vault,
            stockMint: narrative.stockMint,
            treasuryStockAccount: treasury,
            stockTokenProgram: narrative.stockTokenProgram,
          }),
        ],
        async (transaction) => {
          const { signedTransaction } = await signTransaction({
            transaction,
            wallet,
            chain: SOLANA_CHAIN,
          });
          return signedTransaction;
        },
      );
      onDone();
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        onClick={settle}
        variant={quiet ? "ghost" : "accent"}
        disabled={busy}
        className="w-full"
        size={quiet ? "sm" : "lg"}
      >
        {busy ? "Settling…" : quiet ? "Not seeing it? Settle now" : "Settle this narrative"}
      </Button>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </div>
  );
}
