"use client";

/**
 * The hero's proof: the week's best narrative trade, as one number.
 * Somebody traded a story and ended up with more of the stock than buying
 * the stock would have given them. Real trade, read from the chain. The
 * whole card links to the narrative for anyone who wants the detail.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "@solana/kit";

import { formatUsd, shortAddress, stockFor } from "@/lib/config";

/** Everything is shown per this much money in, in dollars. */
const STAKE = 1_000;
import { useStockPrice } from "@/lib/price";
import { useStocks } from "@/lib/stocks";
import { StockLogo } from "./ui";

type Point = { t: number; spot: number };
type SeriesPoint = { t: number; narrative: number; stock: number; price: number };
type Highlight = {
  found: true;
  narrative: { address: Address; name: string; symbol: string; stockMint: Address; stockDecimals: number; sellTaxBps: number };
  points: Point[];
  series: SeriesPoint[];
  trade: {
    owner: Address;
    tokens: number;
    paid: number;
    received: number;
    boughtAt: number;
    exitedAt: number;
    exit: "sold" | "converted";
  };
};

function useHighlight(): Highlight | null | undefined {
  const [state, setState] = useState<Highlight | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/highlight")
      .then((r) => r.json())
      .then((body: Highlight | { found: false }) => {
        if (!cancelled) setState(body.found ? body : null);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function shares(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Two lines over the trade, entry to exit, in dollars so the stock's own move
 * shows: the same $1,000 as shares of the stock, and as the narrative position
 * if sold at that moment. The narrative line ends where the trade did.
 */
function Chart({ h, symbol }: { h: Highlight; symbol: string }) {
  const series = h.series;
  const W = 320;
  const H = 120;
  const padX = 4;
  const padY = 8;
  const t0 = series[0].t;
  const t1 = Math.max(series[series.length - 1].t, t0 + 1);
  const usd = (p: SeriesPoint, which: "narrative" | "stock") => p[which] * p.price;
  const values = series.flatMap((p) => [usd(p, "narrative"), usd(p, "stock")]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, STAKE * 0.02);
  const x = (t: number) => padX + ((t - t0) / (t1 - t0)) * (W - padX * 2);
  const y = (v: number) => H - padY - ((v - lo) / span) * (H - padY * 2);
  const path = (which: "narrative" | "stock") =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(usd(p, which)).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" aria-hidden>
        <path d={path("stock")} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-neutral-300" />
        <path d={path("narrative")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="text-success" />
        <circle cx={x(last.t)} cy={y(usd(last, "narrative"))} r="3.5" className="fill-success" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 text-neutral-600">
          <span className="inline-block h-0.5 w-4 rounded bg-success" />
          Narrative
          <span className="mono ml-1 font-medium text-success">
            {shares(last.narrative)} {symbol}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-neutral-400">
          <span className="inline-block h-px w-4 bg-neutral-300" />
          Stock
          <span className="mono ml-1">
            {shares(last.stock)} {symbol}
          </span>
        </span>
      </div>
    </div>
  );
}

export function Highlight({ fallback }: { fallback: React.ReactNode }) {
  const h = useHighlight();
  useStocks();
  const { price } = useStockPrice(h ? h.narrative.stockMint : null);
  if (h === undefined) return <div className="h-40 animate-pulse rounded bg-neutral-50" aria-hidden />;
  if (h === null) return <>{fallback}</>;

  const stock = stockFor(h.narrative.stockMint, h.narrative.stockDecimals);

  return (
    <Link
      href={`/n/${h.narrative.address}`}
      className="lift block rounded bg-neutral-50 p-5"
    >
      <div className="text-xs text-neutral-400">Best trade this week</div>

      {/* Who bought what. */}
      <div className="mt-2 flex items-center gap-1.5 text-sm">
        <span className="mono text-neutral-600">{shortAddress(h.trade.owner)}</span>
        <span className="text-neutral-400">bought</span>
        <span className="truncate font-medium text-neutral-900">{h.narrative.name}</span>
        <StockLogo stock={stock} size={14} />
      </div>

      {h.series.length > 1 ? (
        <div className="mt-3">
          <Chart h={h} symbol={stock.symbol} />
        </div>
      ) : (
        <div className="numeric mt-3 text-2xl font-semibold tracking-tight text-neutral-900">
          {formatUsd(STAKE, 0)} <span className="text-neutral-400">→</span>{" "}
          <span className="text-success">{formatUsd((STAKE * h.trade.received) / h.trade.paid, 0)}</span>
        </div>
      )}
      {price > 0 ? (
        <div className="mono mt-2 text-xs text-neutral-400">
          {formatUsd(price, 2)} per {stock.symbol} share
        </div>
      ) : null}
    </Link>
  );
}
