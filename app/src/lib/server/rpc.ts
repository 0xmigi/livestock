import { createSolanaRpc } from "@solana/kit";

const DEFAULT =
  process.env.NEXT_PUBLIC_CLUSTER === "mainnet"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

/** The server's own RPC client, same endpoint the browser uses. */
export const rpc = createSolanaRpc(process.env.NEXT_PUBLIC_RPC_URL ?? DEFAULT);
