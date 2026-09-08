import Link from "next/link";

import { CLUSTER, TAGLINE } from "@/lib/config";
import { X_URL } from "@/lib/links";
import { Wordmark } from "./logo";

/**
 * Page footer. The wordmark and the pitch on the left, three short columns
 * of links on the right, one quiet line underneath. A single rule on top
 * marks where the page ends and the footer begins.
 */

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Protocol",
    links: [
      { label: "Markets", href: "/" },
      { label: "Create a narrative", href: "/create" },
      { label: "Analytics", href: "/analytics" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "FAQ", href: "/how-it-works#faq" },
    ],
  },
  {
    title: "Community",
    links: [{ label: "X", href: X_URL, external: true }],
  },
];

export function Footer({ className = "" }: { className?: string }) {
  return (
    <footer className={`relative z-[1] border-t border-neutral-200 pt-10 ${className}`}>
      <div className="grid gap-10 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-16">
        <div className="max-w-xs">
          <Link href="/" className="inline-block transition-opacity hover:opacity-80">
            <Wordmark />
          </Link>
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">{TAGLINE}</p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 sm:gap-14">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="mono text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
                {col.title}
              </div>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-neutral-600 transition-colors hover:text-neutral-900"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-sm text-neutral-600 transition-colors hover:text-neutral-900">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="mono mt-10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
        <span>© {new Date().getFullYear()} Livestock</span>
        <span>Solana{CLUSTER === "mainnet" ? "" : ` · ${CLUSTER}`}</span>
      </div>
    </footer>
  );
}
