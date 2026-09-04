"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

import { CLUSTER, PRIVY_APP_ID, rpc, rpcSubscriptions } from "@/lib/config";

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <h1 className="text-lg font-semibold">Missing Privy app ID</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Copy <code>app/.env.example</code> to <code>app/.env.local</code> and
          set <code>NEXT_PUBLIC_PRIVY_APP_ID</code>.
        </p>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        // Email users get a Solana wallet without ever seeing a seed phrase.
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          // Suppress Privy's own confirm-and-dismiss modal. The user already
          // confirmed in our UI, and Privy's promise does not resolve until
          // that modal is manually closed — long enough for the transaction's
          // blockhash to expire before it is ever broadcast.
          showWalletUIs: false,
        },
        appearance: {
          theme: "light",
          accentColor: "#18181b",
          walletChainType: "solana-only",
          walletList: ["detected_solana_wallets", "phantom", "solflare"],
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        solana: {
          rpcs: {
            [`solana:${CLUSTER}`]: { rpc, rpcSubscriptions },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
