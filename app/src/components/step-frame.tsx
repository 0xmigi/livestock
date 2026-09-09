"use client";

/**
 * One still from the example narrative's life, for a step of the guide.
 * The same seeded walk as the hero's animation (lib/story), drawn as plain
 * SVG so it needs no clock. The four frames share one time axis, and the
 * expiry line stands in the same place in each, so the eye can track it.
 */

import { useMemo, type CSSProperties } from "react";

import { EXPIRY_AT, LAUNCH_AT, LOOP_SECS, NARRATIVE, POST, RANGE_MAX, RANGE_MIN, simulate, STOCK } from "@/lib/story";

/** liveline's y padding, so the lines sit where they do in the animation. */
const MARGIN = 0.12;
/** The time axis takes this much of the width; the rest is for the labels at the line ends. */
const AXIS = 70;
/**
 * Where each step's frame stops, in seconds into the loop: a beat after the
 * post, a beat after the launch, deep into trading, and the end.
 */
const STOP = [8, 8.5, 19, LOOP_SECS] as const;
/** The buy marked on the trading frame: early on the rise. */
const BUY_AT = 9;

export function StepFrame({ step }: { step: 0 | 1 | 2 | 3 }) {
  const story = useMemo(simulate, []);
  const stop = STOP[step];
  const lo = RANGE_MIN - (RANGE_MAX - RANGE_MIN) * MARGIN;
  const hi = RANGE_MAX + (RANGE_MAX - RANGE_MIN) * MARGIN;
  const x = (t: number) => (t / LOOP_SECS) * AXIS;
  const y = (v: number) => (1 - (v - lo) / (hi - lo)) * 100;

  // Step 0 is before the token exists: only the stock, and the post that starts the story.
  const launched = step >= 1;
  const expired = step === 3;
  const shown = story.ticks.filter((k) => k.t <= stop);
  const live = launched ? (shown.filter((k) => k.narrative !== null) as (typeof shown[number] & { narrative: number })[]) : [];
  const stockEnd = shown[shown.length - 1];
  const narEnd = live[live.length - 1];
  const launch = live[0];
  const peak = live.length ? live.reduce((best, k) => (k.narrative > best.narrative ? k : best), live[0]) : undefined;
  const buy = live.find((k) => k.t >= BUY_AT);
  const postTick = shown.find((k) => k.t >= LAUNCH_AT);

  const stockPath = pathOf(shown.map((k) => [x(k.t), y(k.stock)]));
  const narPath = pathOf(live.map((k) => [x(k.t), y(k.narrative)]));

  return (
    <div className="relative h-36 w-full select-none" aria-hidden>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {launched ? (
          <line
            x1={x(EXPIRY_AT)}
            x2={x(EXPIRY_AT)}
            y1={0}
            y2={100}
            stroke="var(--n300)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path d={stockPath} fill="none" stroke="var(--n600)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {narPath ? (
          <path d={narPath} fill="none" stroke="var(--success)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>

      {/* The date, set at launch and standing in the same place from then on. */}
      {launched ? (
        <Label at={{ left: `calc(${x(EXPIRY_AT)}% + 6px)`, top: 0 }} className="text-neutral-400">
          {expired ? "expired" : "expiry"}
        </Label>
      ) : null}

      {/* The stock: a dot at its end, and its name. */}
      {stockEnd ? (
        <>
          <Dot x={x(stockEnd.t)} y={y(stockEnd.stock)} color="var(--n600)" />
          <Label at={{ left: `calc(${x(stockEnd.t)}% + 8px)`, top: `${y(stockEnd.stock)}%` }} middle className="text-neutral-600">
            {STOCK} <span className="text-neutral-900">${stockEnd.stock.toFixed(0)}</span>
          </Label>
        </>
      ) : null}

      {/* Step 0: the story is found. The post, over the moment it lands on the stock. */}
      {postTick && step === 0 ? (
        <>
          <Dot x={x(postTick.t)} y={y(postTick.stock)} color="var(--n600)" />
          <div
            className="pointer-events-none absolute flex items-start gap-2"
            style={{ left: `${x(postTick.t)}%`, top: `calc(${y(postTick.stock)}% - 12px)`, transform: "translateY(-100%)" }}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">
              {POST.name[0]}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 whitespace-nowrap text-[11px] leading-tight">
                <span className="font-semibold text-neutral-900">{POST.name}</span>
                <span className="text-neutral-400">{POST.handle}</span>
              </span>
              <span className="block whitespace-nowrap text-xs leading-snug text-neutral-900">{POST.text}</span>
            </span>
          </div>
        </>
      ) : null}

      {/* Step 1: the token launches at the stock's price, with its date. */}
      {launch && step === 1 ? (
        <>
          <Dot x={x(launch.t)} y={y(launch.narrative)} color="var(--success)" />
          <Label at={{ left: `${x(launch.t)}%`, top: `calc(${y(launch.narrative)}% + 8px)` }} centered className="text-success">
            launch
          </Label>
        </>
      ) : null}

      {/* Step 2: trading. A buy early on the rise, a sell at the top. */}
      {buy && step === 2 ? (
        <>
          <Dot x={x(buy.t)} y={y(buy.narrative)} color="var(--success)" />
          <Label at={{ left: `${x(buy.t)}%`, top: `calc(${y(buy.narrative)}% + 8px)` }} centered className="text-success">
            buy
          </Label>
        </>
      ) : null}
      {peak && step === 2 ? (
        <>
          <Dot x={x(peak.t)} y={y(peak.narrative)} color="var(--success)" hollow />
          <Label at={{ left: `${x(peak.t)}%`, top: `calc(${y(peak.narrative)}% - 8px)` }} centered above className="text-success">
            sell
          </Label>
        </>
      ) : null}
      {narEnd ? (
        <>
          <Dot x={x(narEnd.t)} y={y(narEnd.narrative)} color="var(--success)" />
          <Label at={{ left: `calc(${x(narEnd.t)}% + 8px)`, top: `${y(narEnd.narrative)}%` }} middle className="text-success">
            {expired ? (
              <>
                {NARRATIVE}
                <span className="block text-neutral-900">
                  {story.multiple.toFixed(1)}× in {STOCK}
                </span>
              </>
            ) : (
              <>
                {NARRATIVE} <span className="text-neutral-900">${narEnd.narrative.toFixed(0)}</span>
              </>
            )}
          </Label>
        </>
      ) : null}
    </div>
  );
}

function pathOf(points: [number, number][]): string {
  return points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`).join(" ");
}

/** A marker, sized in pixels so it stays round however the frame is stretched. */
function Dot({ x, y, color, hollow = false }: { x: number; y: number; color: string; hollow?: boolean }) {
  return (
    <span
      className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${x}%`, top: `${y}%`, background: hollow ? "var(--n50)" : color, boxShadow: hollow ? `0 0 0 1.5px ${color}` : undefined }}
    />
  );
}

function Label({
  at,
  middle = false,
  centered = false,
  above = false,
  className = "",
  children,
}: {
  at: CSSProperties;
  /** Vertically centred on its point. */
  middle?: boolean;
  /** Horizontally centred on its point. */
  centered?: boolean;
  /** Sits on top of its point. */
  above?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const tx = centered ? "-50%" : "0";
  const ty = middle ? "-50%" : above ? "-100%" : "0";
  return (
    <span
      className={`mono pointer-events-none absolute whitespace-nowrap text-[10px] leading-tight ${className}`}
      style={{ ...at, transform: `translate(${tx}, ${ty})` }}
    >
      {children}
    </span>
  );
}
