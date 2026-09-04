"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { address, type Address } from "@solana/kit";

import { shortAddress } from "@/lib/config";
import { Button } from "./ui";

/** The connected Solana wallet's address, or null. */
export function useOwner(): Address | null {
  const { wallets } = useWallets();
  return wallets[0] ? address(wallets[0].address) : null;
}

export function ConnectButton() {
  const { ready, authenticated, login, logout } = usePrivy();
  const owner = useOwner();

  if (!ready) {
    return <span className="text-sm text-ink-faint">…</span>;
  }

  if (!authenticated || !owner) {
    return (
      <Button onClick={login} className="px-4 py-2">
        Connect
      </Button>
    );
  }

  return (
    <button
      onClick={() => void logout()}
      title={`${owner} — click to disconnect`}
      className="numeric rounded-full bg-fill px-3.5 py-2 text-xs text-ink-soft transition-colors hover:bg-rule"
    >
      {shortAddress(owner)}
    </button>
  );
}
