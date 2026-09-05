"use client";

/**
 * Account chip and the full-width panel it opens.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { Check, Copy } from "lucide-react";
import { address, type Address } from "@solana/kit";

import { CLUSTER, formatUsd, rpc, shortAddress } from "@/lib/config";
import { formatCountdown, useNarratives, useNow } from "@/lib/narratives";
import { useSolPrice } from "@/lib/stocks";
import { Thumb } from "./thumb";
import { Avatar, phaseOf } from "./ui";

/** The connected Solana wallet's address, or null. */
export function useOwner(): Address | null {
  const { wallets } = useWallets();
  return wallets[0] ? address(wallets[0].address) : null;
}

// Every balance hook reloads when something (an airdrop, a buy) asks it to.
const balanceListeners = new Set<() => void>();

/** Tells every SOL balance on the page to reload now. */
export function refreshSolBalances(): void {
  for (const l of balanceListeners) l();
}

/** The wallet's SOL balance, refreshed every half minute. */
export function useSolBalance(owner: Address | null): number | null {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!owner) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { value } = await rpc.getBalance(owner, { commitment: "confirmed" }).send();
        if (!cancelled) setBalance(Number(value) / 1e9);
      } catch {
        // Balance is decoration; never let it break the page.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    const listener = () => void load();
    balanceListeners.add(listener);
    return () => {
      cancelled = true;
      clearInterval(timer);
      balanceListeners.delete(listener);
    };
  }, [owner]);

  return balance;
}

/** Writes to the clipboard, falling back to a selection copy where the API is blocked. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Embedded browsers and some permission setups refuse the API.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copies text and reports "copied" for a moment. */
function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (text: string) => {
    void copyText(text).then((ok) => setCopied(ok));
  };
  return [copied, copy];
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/n/");
  return pathname.startsWith(href);
}

export function AccountChip() {
  const { ready, authenticated, login } = usePrivy();
  const owner = useOwner();
  const [open, setOpen] = useState(false);

  if (!ready) {
    return <span className="h-9 w-20 rounded bg-neutral-100" aria-hidden />;
  }

  if (!authenticated || !owner) {
    return (
      <button
        type="button"
        onClick={login}
        className="h-9 shrink-0 whitespace-nowrap rounded bg-neutral-100 px-3 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 sm:px-4"
      >
        Log in
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 shrink-0 items-center gap-2 rounded bg-neutral-100 px-2.5 transition-colors hover:bg-neutral-200"
      >
        <Avatar seed={owner} size={22} />
        <span className="numeric text-sm font-medium text-neutral-900">
          {shortAddress(owner)}
        </span>
      </button>
      {open ? <AccountMenu owner={owner} onClose={() => setOpen(false)} placement="header" /> : null}
    </div>
  );
}

/**
 * The account menu: who you are, what you hold, and the way out. It hangs off
 * the chip in the header, or sits above the tab bar on phones, and looks like
 * every other dropdown on the page.
 */
export function AccountMenu({
  owner,
  onClose,
  placement,
}: {
  owner: Address;
  onClose: () => void;
  placement: "header" | "tabbar";
}) {
  const { logout } = usePrivy();
  const sol = useSolBalance(owner);
  const solUsd = useSolPrice();
  const [copied, copy] = useCopy();
  const { rows } = useNarratives();
  const now = useNow();
  const created = useMemo(
    () => (rows ?? []).filter((n) => n.creator === owner).sort((a, b) => Number(b.createdTs - a.createdTs)),
    [rows, owner],
  );

  const position =
    placement === "header"
      ? "absolute right-0 top-full z-50 mt-2 w-80"
      : "fixed inset-x-4 bottom-24 z-50";

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="menu"
        className={`${position} overflow-hidden rounded border border-neutral-200 bg-ground shadow-xl`}
      >
        <div className="flex items-center gap-3 p-4">
          <Avatar seed={owner} size={36} />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => copy(owner)}
              title={owner}
              className="mono group flex max-w-full items-center gap-1.5 text-[13px] text-neutral-900"
            >
              <span className="truncate">{shortAddress(owner, 6)}</span>
              {copied ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition-colors group-hover:text-neutral-900" />
              )}
            </button>
            <p className="mt-0.5 text-xs text-neutral-400">Solana · {CLUSTER}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="numeric text-sm font-semibold text-neutral-900">
              {sol === null ? "—" : `${sol.toFixed(2)} SOL`}
            </p>
            {sol !== null && solUsd ? (
              <p className="numeric text-xs text-neutral-400">{formatUsd(sol * solUsd)}</p>
            ) : null}
          </div>
        </div>
        {/* What you have created. Each opens its page, where the creator can edit it. */}
        <div className="border-t border-neutral-200">
          <p className="px-4 pt-3 text-xs text-neutral-400">Created</p>
          {rows === null ? (
            <p className="px-4 pb-3 pt-1 text-sm text-neutral-400">…</p>
          ) : created.length === 0 ? (
            <p className="px-4 pb-3 pt-1 text-sm text-neutral-400">Nothing yet.</p>
          ) : (
            <ul className="max-h-64 overflow-auto py-1">
              {created.map((n) => {
                const left = Number(n.expiryTs) - now;
                const phase = phaseOf(n.status, left);
                return (
                  <li key={n.address}>
                    <Link
                      href={`/n/${n.address}`}
                      onClick={onClose}
                      className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-neutral-50"
                    >
                      <Thumb src={n.meta?.image} name={n.name} size={28} shape="square" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-900">{n.name}</span>
                        <span className="mono block text-xs text-neutral-400">
                          ${n.symbol} ·{" "}
                          {phase === "live" || phase === "closing"
                            ? `${formatCountdown(left)} left`
                            : phase === "settling"
                              ? "needs settling"
                              : phase === "redeemable"
                                ? "redeemable"
                                : "settled"}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            void logout();
          }}
          className="block w-full border-t border-neutral-200 px-4 py-3 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
        >
          Log out
        </button>
      </div>
    </>
  );
}
