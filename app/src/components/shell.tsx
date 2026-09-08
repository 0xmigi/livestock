"use client";

/**
 * Page frame. One container width everywhere, and a header that is identical
 * on every page, so nothing shifts when you navigate.
 *
 * Desktop: wordmark, then Markets / Create / Analytics as one control and
 * the account on the right. A footer under every page.
 * Mobile: wordmark and account in the bar; Markets, Create, Analytics and
 * Account in a floating tab bar at the bottom.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { BarChart3, LineChart, Plus, UserRound } from "lucide-react";

import { Wordmark } from "./logo";
import { Footer } from "./footer";
import { Wash } from "./wash";
import { AccountChip, AccountMenu, isActivePath, useOwner } from "./wallet";

export const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8";

export function Shell({
  children,
  bottom,
}: {
  children: React.ReactNode;
  /** A bar pinned to the bottom of the viewport. Replaces the tab bar on phones. */
  bottom?: React.ReactNode;
}) {
  return (
    <div className="ground flex min-h-screen flex-col">
      <Wash />
      <header className={`${CONTAINER} relative z-20 flex h-20 items-center justify-between gap-4`}>
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-6">
          <PageNav />
          <AccountChip />
        </div>
      </header>

      <main className={`${CONTAINER} relative z-[1] flex-1 pt-4 sm:pt-8`}>{children}</main>

      {/* Clearance at the bottom for the tab bar on phones and the pinned bar when there is one. */}
      <Footer className={`${CONTAINER} mt-24 pb-32 sm:mt-28 sm:pb-12`} />

      {bottom ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 sm:bottom-6">
          <div className={`${CONTAINER} pointer-events-auto`}>{bottom}</div>
        </div>
      ) : null}

      {bottom ? null : <TabBar />}
    </div>
  );
}

const PAGES = [
  { href: "/", label: "Markets" },
  { href: "/create", label: "Create" },
  { href: "/analytics", label: "Analytics" },
];

/** The three pages as plain words, desktop only. The current one is dark with a mark under it. */
function PageNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Pages" className="hidden items-center gap-6 sm:flex">
      {PAGES.map((p) => {
        const on = isActivePath(pathname, p.href);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={`relative py-1 text-sm transition-colors ${
              on ? "font-medium text-neutral-900" : "text-neutral-400 hover:text-neutral-900"
            }`}
          >
            {p.label}
            {on ? <span aria-hidden className="absolute -bottom-0.5 left-0 h-0.5 w-full rounded-full bg-accent" /> : null}
          </Link>
        );
      })}
    </nav>
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
      <nav className="fixed inset-x-4 bottom-4 z-40 flex gap-1 rounded bg-neutral-50/95 p-1.5 shadow-xl shadow-black/20 backdrop-blur sm:hidden">
        <Link href="/" className={`${base} ${isActivePath(pathname, "/") ? on : off}`}>
          <LineChart className="h-5 w-5" strokeWidth={2} />
          Markets
        </Link>
        <Link href="/create" className={`${base} ${isActivePath(pathname, "/create") ? on : off}`}>
          <Plus className="h-5 w-5" strokeWidth={2} />
          Create
        </Link>
        <Link href="/analytics" className={`${base} ${isActivePath(pathname, "/analytics") ? on : off}`}>
          <BarChart3 className="h-5 w-5" strokeWidth={2} />
          Analytics
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
      {open && owner ? <AccountMenu owner={owner} onClose={() => setOpen(false)} placement="tabbar" /> : null}
    </>
  );
}
