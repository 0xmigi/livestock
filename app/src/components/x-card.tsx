/**
 * The card X renders when a post carries the token's contract address or
 * cashtag: image, name, ticker, price and a sparkline. Shown while naming, so
 * the name is judged the way it will be shared. The name column is sized to
 * cut about where X's does, so a long name loses its tail here first.
 */

import { Thumb } from "./thumb";

export function XCard({
  name,
  symbol,
  image,
  price,
}: {
  name: string;
  symbol: string;
  image?: string;
  price: string;
}) {
  const clean = name.trim();
  return (
    <div className="rounded-2xl bg-neutral-50 p-3">
      <div className="flex items-center gap-3">
        <Thumb src={image} name={clean || "?"} size={40} shape="circle" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight text-neutral-900">
            {clean || <span className="font-normal text-neutral-300">Your narrative</span>}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 text-xs leading-tight">
            <span className="text-neutral-400">{symbol || "TICKER"}</span>
            <span className="font-medium text-neutral-900">{price}</span>
          </div>
        </div>
        <Sparkline className="h-8 w-[88px] shrink-0 text-emerald-600" />
      </div>
    </div>
  );
}

// One fixed walk for every preview: seeding it on the name would redraw the
// line on every keystroke.
const POINTS = walk("livestock", 40);
const PATH = POINTS.map(
  (v, i) => `${i === 0 ? "M" : "L"}${((i / (POINTS.length - 1)) * 100).toFixed(1)} ${(30 - v * 28).toFixed(1)}`,
).join(" ");

function Sparkline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={className} aria-hidden>
      <path
        d={PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A gently rising random walk, normalised to fill its height. */
function walk(seed: string, n: number): number[] {
  const next = rng(seed);
  const ys: number[] = [];
  let y = 0.3;
  for (let i = 0; i < n; i++) {
    y = Math.min(1, Math.max(0, y + (next() - 0.46) * 0.2));
    ys.push(y);
  }
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  return ys.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5));
}

function rng(seed: string): () => number {
  let a = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 0x85ebca6b);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
