"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

import { CLUSTER, PRIVY_APP_ID, rpc, rpcSubscriptions } from "@/lib/config";
import { useTheme } from "@/lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  if (!PRIVY_APP_ID) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 font-sans">
        <h1 className="text-lg font-semibold text-neutral-900">Missing Privy app ID</h1>
        <p className="mt-2 text-sm text-neutral-600">
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
        // Login methods come from the Privy dashboard. Listing them here would
        // override it, which is how Google and X went missing.
        // Email and social users get a Solana wallet without ever seeing a seed phrase.
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          // Suppress Privy's own confirm-and-dismiss modal. The user already
          // confirmed in our UI, and Privy's promise does not resolve until
          // that modal is manually closed — long enough for the transaction's
          // blockhash to expire before it is ever broadcast.
          showWalletUIs: false,
        },
        appearance: {
          // A hex theme paints the modal on our own ground; the rest of the
          // palette comes from the --privy-* variables in globals.css.
          theme: theme === "dark" ? "#141414" : "#ffffff",
          accentColor: theme === "dark" ? "#516af6" : "#3b53e0",
          landingHeader: "Log in to Livestock",
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
