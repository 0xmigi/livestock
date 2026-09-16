"use client";

/**
 * What launching a narrative costs its creator, so the review step can say so
 * before the wallet is asked, rather than after the network refuses.
 *
 * Nearly all of it is rent on three new accounts: the narrative mint, the
 * narrative itself, and the vault that holds its stock.
 */

import { useEffect, useState } from "react";
import { NARRATIVE_ACCOUNT_LEN, TOKEN_2022_PROGRAM_ID } from "@nm/client";
import { fetchMaybeMint, getTokenSize, type ExtensionArgs } from "@solana-program/token-2022";
import type { Address } from "@solana/kit";

import { rpc } from "./config";

/** The creator's signature and the fresh mint keypair's. */
const SIGNATURE_FEES = 2n * 5_000n;

/**
 * The account extensions Token-2022 adds to any token account for a mint
 * carrying these, as its `get_required_init_account_extensions` does.
 */
const ACCOUNT_EXTENSION_FOR: Partial<Record<string, ExtensionArgs>> = {
  TransferFeeConfig: { __kind: "TransferFeeAmount", withheldAmount: 0n },
  NonTransferable: { __kind: "NonTransferableAccount" },
  TransferHook: { __kind: "TransferHookAccount", transferring: false },
  ConfidentialTransferFee: {
    __kind: "ConfidentialTransferFeeAmount",
    withheldAmount: new Uint8Array(64),
  },
  PausableConfig: { __kind: "PausableAccount" },
};

const vaultSizes = new Map<Address, Promise<number>>();

/** Bytes in the vault: an associated token account for the stock mint. */
function vaultSize(stockMint: Address): Promise<number> {
  let size = vaultSizes.get(stockMint);
  if (!size) {
    size = fetchMaybeMint(rpc, stockMint).then((mint) => {
      if (!mint.exists || mint.programAddress !== TOKEN_2022_PROGRAM_ID) return 165;
      const extensions = mint.data.extensions.__option === "Some" ? mint.data.extensions.value : [];
      return getTokenSize([
        // Every associated account on Token-2022 is created immutable.
        { __kind: "ImmutableOwner" },
        ...extensions.flatMap((e) => ACCOUNT_EXTENSION_FOR[e.__kind] ?? []),
      ]);
    });
    size.catch(() => vaultSizes.delete(stockMint));
    vaultSizes.set(stockMint, size);
  }
  return size;
}

const rent = async (bytes: number) =>
  rpc.getMinimumBalanceForRentExemption(BigInt(bytes)).send();

/**
 * Lamports a launch needs in the creator's wallet, for a mint of `mintSize`
 * bytes. More than it spends: a wallet must end a transaction either empty or
 * above the minimum balance every account keeps, and a launch never leaves it
 * exactly empty, so that minimum has to still be there afterwards.
 */
export async function launchCost(stockMint: Address, mintSize: number): Promise<bigint> {
  const [mint, narrative, vault, floor] = await Promise.all([
    rent(mintSize),
    rent(NARRATIVE_ACCOUNT_LEN),
    vaultSize(stockMint).then(rent),
    rent(0),
  ]);
  return mint + narrative + vault + SIGNATURE_FEES + floor;
}

/** The launch cost, recomputed when the stock or the mint's size changes. */
export function useLaunchCost(stockMint: Address | null, mintSize: number): bigint | null {
  const [cost, setCost] = useState<bigint | null>(null);

  useEffect(() => {
    setCost(null);
    if (!stockMint) return;
    let cancelled = false;
    launchCost(stockMint, mintSize).then(
      (lamports) => !cancelled && setCost(lamports),
      // Unknown just means no warning; the launch still checks before signing.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [stockMint, mintSize]);

  return cost;
}

/** SOL to four places. What is needed rounds up, what is held rounds down. */
function sol(lamports: bigint, round: (n: number) => number): string {
  return (round(Number(lamports) / 100_000) / 10_000).toFixed(4);
}

/** Says how far short the wallet is, or null when it can pay. */
export function launchShortfall(cost: bigint, balance: bigint): string | null {
  if (balance >= cost) return null;
  return `Launching needs ${sol(cost, Math.ceil)} SOL: rent, fees and the minimum balance a wallet keeps. This one has ${sol(balance, Math.floor)} SOL, so add ${sol(cost - balance, Math.ceil)} SOL.`;
}
