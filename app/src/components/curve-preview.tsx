"use client";

/**
 * A small picture of the bonding curve: price per token against supply, with
 * the dollar figures a creator actually cares about.
 */

import { buyCost, spotPrice, type CurveParams } from "@nm/client";

import { formatUsd, formatUsdAuto } from "@/lib/config";

export function CurvePreview({
  params,
  stockPriceUsd,
  stockDecimals,
  stockSymbol,
  maxSupply = 1_000_000n,
}: {
  params: CurveParams;
  stockPriceUsd: number;
  stockDecimals: number;
  stockSymbol: string;
  maxSupply?: bigint;
}) {
  const toUsd = (units: bigint) =>
    (Number(units) / 10 ** stockDecimals) * stockPriceUsd;

  const first = spotPrice(0n, params);
  const last = spotPrice(maxSupply, params);
  const firstHundred = buyCost(0n, 100n, params);
  const halfway = spotPrice(maxSupply / 2n, params);

  // The curve is linear, so two points draw it. The area under it is what the
  // vault holds at that supply.
  const w = 320;
  const h = 96;
  const pad = 6;
  const y = (p: bigint) =>
    h - pad - (Number(p - first) / Number(last - first || 1n)) * (h - 2 * pad);

  const x0 = pad;
  const x1 = w - pad;
  const y0 = y(first);
  const y1 = y(last);

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-24 w-full"
        role="img"
        aria-label="Price per token rises linearly with supply"
      >
        <defs>
          <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d97706" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#d97706" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`${x0},${h - pad} ${x0},${y0} ${x1},${y1} ${x1},${h - pad}`}
          fill="url(#curve-fill)"
        />
        <line
          x1={x0}
          y1={y0}
          x2={x1}
          y2={y1}
          stroke="#d97706"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={x0} cy={y0} r="3" fill="#1a1a18" />
        <circle cx={x1} cy={y1} r="3" fill="#1a1a18" />
      </svg>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <Figure label="First token" value={formatUsdAuto(toUsd(first))} />
        <Figure
          label={`At ${(Number(maxSupply) / 2).toLocaleString()}`}
          value={formatUsdAuto(toUsd(halfway))}
        />
        <Figure
          label={`At ${Number(maxSupply).toLocaleString()}`}
          value={formatUsdAuto(toUsd(last))}
        />
      </div>

      <p className="text-xs text-neutral-400">
        The first 100 tokens cost{" "}
        <span className="numeric text-neutral-600">
          {formatUsd(toUsd(firstHundred))}
        </span>{" "}
        in {stockSymbol}. Early buyers pay less per token than late buyers and
        everyone redeems at the same average, which is where early gains come
        from.
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-neutral-400">
        {label}
      </div>
      <div className="numeric mt-0.5 font-medium text-neutral-900">{value}</div>
    </div>
  );
}
