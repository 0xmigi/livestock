import { createSolanaRpc } from "@solana/kit";

const DEFAULT =
  process.env.NEXT_PUBLIC_CLUSTER === "mainnet"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

/**
 * The server's own RPC client. `RPC_URL` is server-only and never reaches
 * the browser, so it can carry an unrestricted key; the browser's
 * `NEXT_PUBLIC_RPC_URL` is the fallback, then the public endpoint.
 */
export const rpc = createSolanaRpc(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || DEFAULT);
