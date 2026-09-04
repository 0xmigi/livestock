"use client";

/**
 * Page frame.
 *
 * Desktop: wordmark, text nav and the account chip in one bar.
 * Mobile: the bar carries only the wordmark and the chip; navigation moves to
 * a floating tab bar at the bottom, the way consumer trading apps do it.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LineChart, Plus, UserRound } from "lucide-react";

import { Wordmark } from "./logo";
import { AccountChip, AccountPanel, isActivePath, NAV, useOwner } from "./wallet";

export function Shell({
  children,
  width = "default",
}: {
  children: React.ReactNode;
  width?: "default" | "narrow";
}) {
  const pathname = usePathname();
  const max = width === "narrow" ? "max-w-xl" : "max-w-2xl";

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="flex h-16 w-full items-center justify-between gap-4 px-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" className="shrink-0 transition-opacity hover:opacity-80">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-4 py-2 text-[15px] transition-colors ${
                  isActivePath(pathname, item.href)
                    ? "text-neutral-900"
                    : "text-neutral-400 hover:text-neutral-900"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <AccountChip />
      </header>

      <main
        className={`mx-auto w-full flex-1 px-5 pb-32 pt-4 sm:px-6 sm:pb-24 sm:pt-8 ${max}`}
      >
        {children}
      </main>

      <TabBar />
    </div>
  );
}

/** Floating bottom navigation, mobile only. */
function TabBar() {
  const pathname = usePathname();
  const { ready, authenticated, login } = usePrivy();
  const owner = useOwner();
  const [open, setOpen] = useState(false);

  const base =
    "flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors";
  const on = "text-neutral-900";
  const off = "text-neutral-400";

  return (
    <>
      <nav className="fixed inset-x-4 bottom-4 z-40 flex gap-1 rounded-2xl border border-neutral-200 bg-white/95 p-1.5 shadow-lg shadow-neutral-900/10 backdrop-blur sm:hidden">
        <Link
          href="/"
          className={`${base} ${isActivePath(pathname, "/") ? on : off}`}
        >
          <LineChart className="h-5 w-5" strokeWidth={2} />
          Markets
        </Link>
        <Link
          href="/create"
          className={`${base} ${isActivePath(pathname, "/create") ? on : off}`}
        >
          <Plus className="h-5 w-5" strokeWidth={2} />
          Create
        </Link>
        <button
          type="button"
          onClick={() => (authenticated && owner ? setOpen(true) : login())}
          disabled={!ready}
          className={`${base} ${off}`}
        >
          <UserRound className="h-5 w-5" strokeWidth={2} />
          {authenticated && owner ? "Account" : "Log in"}
        </button>
      </nav>
      {open && owner ? (
        <AccountPanel owner={owner} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
