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
import { getExpireInstruction } from "@nm/client";
import type { Address } from "@solana/kit";

import { SOLANA_CHAIN } from "@/lib/config";
import type { NarrativeRow } from "@/lib/narratives";
import { signAndSend, toUserMessage } from "@/lib/tx";
import { Button, Notice } from "./ui";

export function ExpireButton({
  narrative,
  owner,
  onDone,
}: {
  narrative: NarrativeRow;
  owner: Address;
  onDone: () => void;
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
      await signAndSend(
        owner,
        [
          getExpireInstruction({
            narrative: narrative.address,
            narrativeMint: narrative.narrativeMint,
            vault: narrative.vault,
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
      <Button onClick={settle} disabled={busy} className="w-full" size="lg">
        {busy ? "Settling…" : "Settle this narrative"}
      </Button>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </div>
  );
}
