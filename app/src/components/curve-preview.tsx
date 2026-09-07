"use client";

/**
 * A small picture of the bonding curve: price per token against supply, with
 * the dollar figures a creator actually cares about.
 */

import {
  INITIAL_REAL_TOKEN_RESERVES,
  spotPriceAt,
  TOKEN_TOTAL_SUPPLY,
  type CurveState,
} from "@nm/client";

import { formatUsd, formatUsdAuto } from "@/lib/config";
import { Tile } from "./ui";

const POINTS = 48;

export function CurvePreview({
  curve,
  stockPriceUsd,
  stockDecimals,
  stockSymbol,
}: {
  /** The opening reserves. */
  curve: CurveState;
  stockPriceUsd: number;
  stockDecimals: number;
  stockSymbol: string;
}) {
  const toUsd = (units: number) => (units / 10 ** stockDecimals) * stockPriceUsd;
  const priceAt = (supply: bigint) => spotPriceAt(curve, 0n, supply);
  const capAt = (supply: bigint) => toUsd(priceAt(supply) * Number(TOKEN_TOTAL_SUPPLY));

  const cap = INITIAL_REAL_TOKEN_RESERVES;
  const first = priceAt(0n);
  const last = priceAt(cap);
  const halfway = priceAt(cap / 2n);

  // The curve is a hyperbola, so it is sampled. The area under it is what the
  // vault holds at that supply.
  const w = 320;
  const h = 96;
  const pad = 6;
  const x = (i: number) => pad + (i / POINTS) * (w - 2 * pad);
  const y = (p: number) => h - pad - ((p - first) / (last - first || 1)) * (h - 2 * pad);
  const samples = Array.from({ length: POINTS + 1 }, (_, i) => {
    const supply = (cap * BigInt(i)) / BigInt(POINTS);
    return `${x(i)},${y(priceAt(supply))}`;
  });

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-24 w-full"
        role="img"
        aria-label="Price per token rises with supply, steeply towards the end"
      >
        <defs>
          <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`${x(0)},${h - pad} ${samples.join(" ")} ${x(POINTS)},${h - pad}`}
          fill="url(#curve-fill)"
        />
        <polyline
          points={samples.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={x(0)} cy={y(first)} r="3" fill="var(--n900)" />
        <circle cx={x(POINTS)} cy={y(last)} r="3" fill="var(--n900)" />
      </svg>

      <div className="grid grid-cols-3 gap-2 rounded bg-neutral-50 p-2">
        <Tile label="Opens at" value={formatUsdAuto(capAt(0n))} sub="market cap" />
        <Tile label="Halfway" value={formatUsdAuto(capAt(cap / 2n))} sub={formatUsdAuto(toUsd(halfway)) + " per token"} />
        <Tile label="Sold out" value={formatUsdAuto(capAt(cap))} sub={formatUsdAuto(toUsd(last)) + " per token"} />
      </div>

      <p className="text-xs text-neutral-400">
        pump.fun&apos;s curve, in {stockSymbol}: a billion tokens, 793.1 million of them sold by the
        curve, opening at {formatUsd(capAt(0n), 0)} of market cap. Early buyers pay less per token
        than late buyers and everyone converts at the same average, which is where early gains come
        from.
      </p>
    </div>
  );
}
