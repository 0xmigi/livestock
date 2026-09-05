"use client";

/**
 * Page frame. One container width everywhere, and a header that is identical
 * on every page, so nothing shifts when you navigate.
 *
 * Desktop: wordmark, then Create, theme and account on the right.
 * Mobile: wordmark and account in the bar; Markets, Create and Account in a
 * floating tab bar at the bottom.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LineChart, Plus, UserRound } from "lucide-react";

import { ThemeToggle } from "@/lib/theme";
import { Wordmark } from "./logo";
import { Button } from "./ui";
import { AccountChip, AccountPanel, isActivePath, useOwner } from "./wallet";

export const CONTAINER = "mx-auto w-full max-w-5xl px-5 sm:px-8";

export function Shell({
  children,
  bottom,
}: {
  children: React.ReactNode;
  /** A bar pinned to the bottom of the viewport. Replaces the tab bar on phones. */
  bottom?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <header className={`${CONTAINER} flex h-20 items-center justify-between gap-4`}>
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/create" className="hidden sm:block">
            <Button variant="accent" className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Create
            </Button>
          </Link>
          <ThemeToggle className="hidden sm:flex" />
          <AccountChip />
        </div>
      </header>

      <main className={`${CONTAINER} flex-1 pb-32 pt-4 sm:pb-28 sm:pt-8`}>{children}</main>

      {bottom ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 sm:bottom-6">
          <div className={`${CONTAINER} pointer-events-auto`}>{bottom}</div>
        </div>
      ) : null}

      {bottom ? null : <TabBar />}
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
    "flex flex-1 flex-col items-center justify-center gap-1 rounded py-2 text-[11px] font-medium transition-colors";
  const on = "text-neutral-900";
  const off = "text-neutral-400";

  return (
    <>
      <nav className="fixed inset-x-4 bottom-4 z-40 flex gap-1 rounded border border-neutral-200 bg-neutral-50/95 p-1.5 shadow-lg backdrop-blur sm:hidden">
        <Link href="/" className={`${base} ${isActivePath(pathname, "/") ? on : off}`}>
          <LineChart className="h-5 w-5" strokeWidth={2} />
          Markets
        </Link>
        <Link href="/create" className={`${base} ${isActivePath(pathname, "/create") ? on : off}`}>
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
      {open && owner ? <AccountPanel owner={owner} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
