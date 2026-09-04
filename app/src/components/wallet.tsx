"use client";

/**
 * Account chip and panel, after Moment's top-right profile pill and the
 * full-width dropdown it opens.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { X } from "lucide-react";
import { address, type Address } from "@solana/kit";

import { CLUSTER, rpc, shortAddress, TAGLINE } from "@/lib/config";
import { Wordmark } from "./logo";
import { Avatar } from "./ui";

/** The connected Solana wallet's address, or null. */
export function useOwner(): Address | null {
  const { wallets } = useWallets();
  return wallets[0] ? address(wallets[0].address) : null;
}

function useSolBalance(owner: Address | null): number | null {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!owner) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { value } = await rpc.getBalance(owner).send();
        if (!cancelled) setBalance(Number(value) / 1e9);
      } catch {
        // Balance is decoration; never let it break the page.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [owner]);

  return balance;
}

export const NAV = [
  { href: "/", label: "Markets" },
  { href: "/create", label: "Create" },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/n/");
  return pathname.startsWith(href);
}

export function AccountChip() {
  const { ready, authenticated, login } = usePrivy();
  const owner = useOwner();
  const [open, setOpen] = useState(false);

  if (!ready) {
    return <span className="h-9 w-20 rounded-lg bg-neutral-100" aria-hidden />;
  }

  if (!authenticated || !owner) {
    return (
      <button
        type="button"
        onClick={login}
        className="shrink-0 whitespace-nowrap rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 sm:px-4"
      >
        Log in
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-2 rounded-lg bg-neutral-100 px-3 py-1.5 transition-colors hover:bg-neutral-200"
      >
        <Avatar seed={owner} size={24} />
        <span className="numeric text-sm font-medium text-neutral-900">
          {shortAddress(owner)}
        </span>
      </button>
      {open ? <AccountPanel owner={owner} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function AccountPanel({
  owner,
  onClose,
}: {
  owner: Address;
  onClose: () => void;
}) {
  const { logout } = usePrivy();
  const pathname = usePathname();
  const sol = useSolBalance(owner);

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />

      <div className="relative">
        <div className="flex h-16 items-center justify-between bg-white px-6">
          <Wordmark />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-neutral-100 p-2 transition-colors hover:bg-neutral-200"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-neutral-600" />
          </button>
        </div>

        <div className="space-y-4 rounded-b-xl bg-white px-6 pb-6 pt-2 shadow-lg">
          <div className="rounded-xl bg-neutral-100 p-4">
            <div className="flex items-center gap-3">
              <Avatar seed={owner} size={40} />
              <div className="min-w-0 flex-1">
                <p className="numeric truncate text-[15px] font-semibold text-neutral-900">
                  {shortAddress(owner, 6)}
                </p>
                <p className="text-xs text-neutral-400">
                  Solana · {CLUSTER}
                </p>
              </div>
              <p className="numeric text-[15px] font-semibold text-neutral-900">
                {sol === null ? "—" : `${sol.toFixed(2)} SOL`}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`block rounded-lg px-4 py-3 text-[15px] transition-colors ${
                  isActivePath(pathname, item.href)
                    ? "bg-neutral-100 font-medium text-neutral-900"
                    : "text-neutral-400 hover:bg-neutral-50"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                onClose();
                void logout();
              }}
              className="block w-full rounded-lg px-4 py-3 text-left text-[15px] text-neutral-400 transition-colors hover:bg-neutral-50"
            >
              Log out
            </button>
          </div>

          <p className="pt-1 text-center text-xs text-neutral-400">{TAGLINE}</p>
        </div>
      </div>
    </div>
  );
}
