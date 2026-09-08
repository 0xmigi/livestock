"use client";

/**
 * The price tape: every tokenized stock with a live price, sliding across
 * the top of the markets page. Real prices and 24h moves from the registry,
 * so the page has something true to show whatever is launched. Hover holds
 * it still. Each entry opens Create with that stock picked.
 */

import Link from "next/link";

import { formatUsd } from "@/lib/config";
import { useStocks } from "@/lib/stocks";
import { StockLogo } from "./ui";

/** How many stocks ride the tape. The deepest come first in the registry. */
const TAPE = 40;

export function Ticker() {
  const { stocks } = useStocks();
  const items = stocks.filter((s) => s.priceUsd !== undefined && s.priceUsd > 0).slice(0, TAPE);
  if (items.length < 8) return null;
  // Twice over, so the loop has no seam.
  const row = [...items, ...items];
  return (
    <div
      className="ticker -mx-5 overflow-hidden opacity-55 transition-opacity hover:opacity-100 sm:mx-0"
      style={{ maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)" }}
      aria-label="Tokenized stock prices"
    >
      <div className="ticker-track flex w-max items-center gap-7 pr-7">
        {row.map((s, i) => {
          const change = s.change24hPercent;
          return (
            <Link
              key={`${s.mint}-${i}`}
              href={`/create?stock=${encodeURIComponent(s.symbol)}`}
              className="mono flex shrink-0 items-center gap-1.5 text-xs text-neutral-400 transition-colors hover:text-neutral-900"
              aria-hidden={i >= items.length}
              tabIndex={i >= items.length ? -1 : undefined}
            >
              <StockLogo stock={s} size={14} />
              <span className="text-neutral-900">{s.symbol}</span>
              <span>{formatUsd(s.priceUsd ?? 0)}</span>
              {change !== undefined ? (
                <span className={change >= 0 ? "text-success" : "text-danger"}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(1)}%
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
