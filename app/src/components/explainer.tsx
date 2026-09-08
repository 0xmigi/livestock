"use client";

/**
 * The hero's explainer: one narrative's life, on a loop, as a live chart.
 *
 * A stock ticks along. Something happens to the company and a narrative
 * launches on it: a second line, in the brand colour, that runs hotter than
 * the stock. On its date the narrative expires and every token becomes the
 * stock; the narrative line stops and the stock line carries on. Then it
 * starts again with a different story.
 *
 * Simulated, and says so. It stands in for "best trade this week" until
 * there are real trades to show, and it is drawn with liveline so it feels
 * like the market pages rather than a diagram.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LivelinePoint, LivelineSeries } from "liveline";

import { useTheme } from "@/lib/theme";

const Liveline = dynamic(() => import("liveline").then((m) => m.Liveline), { ssr: false });

/** One loop, in seconds of wall-clock time. */
const LOOP_SECS = 22;
/** When the story breaks and the narrative launches. */
const LAUNCH_AT = 5;
/** When the narrative expires into the stock. */
const EXPIRY_AT = 16;
/** The chart's visible time window. The whole loop fits inside it. */
const WINDOW_SECS = LOOP_SECS;
/** How often a point is added. */
const TICK_MS = 120;

/** Same $100 into each, so the two lines are directly comparable. */
const STAKE = 100;

type Story = { stock: string; ticker: string; event: string; narrative: string };

/** Every loop tells a different one. All plausible, none real. */
const STORIES: Story[] = [
  { stock: "NVDAx", ticker: "NVDA", event: "NVIDIA teases a new chip", narrative: "$BLACKWELL2" },
  { stock: "TSLAx", ticker: "TSLA", event: "Robotaxi pilot goes live in Austin", narrative: "$ROBOTAXI" },
  { stock: "AAPLx", ticker: "AAPL", event: "Apple rumoured to ship a foldable", narrative: "$FOLD" },
  { stock: "COINx", ticker: "COIN", event: "Coinbase files for a bank charter", narrative: "$CBBANK" },
  { stock: "HOODx", ticker: "HOOD", event: "Robinhood opens tokenized stocks to the EU", narrative: "$HOODEU" },
];

type Phase = "before" | "live" | "after";

function phaseAt(t: number): Phase {
  if (t < LAUNCH_AT) return "before";
  if (t < EXPIRY_AT) return "live";
  return "after";
}

/** A gentle random walk with a drift, in percent per tick. */
function step(value: number, drift: number, noise: number): number {
  return value * (1 + drift + (Math.random() - 0.5) * noise);
}

export function Explainer({ className = "" }: { className?: string }) {
  const { theme } = useTheme();
  const [story, setStory] = useState(0);
  const [phase, setPhase] = useState<Phase>("before");
  const [stock, setStock] = useState<LivelinePoint[]>([]);
  const [narrative, setNarrative] = useState<LivelinePoint[]>([]);
  const start = useRef<number>(0);
  const frozen = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let stockValue = STAKE;
    let narrativeValue = STAKE;
    let lastPhase: Phase = "before";

    const reset = () => {
      start.current = Date.now();
      stockValue = STAKE;
      narrativeValue = STAKE;
      frozen.current = null;
      lastPhase = "before";
      setStock([]);
      setNarrative([]);
      setPhase("before");
    };
    reset();

    const timer = setInterval(() => {
      if (!alive) return;
      const nowMs = Date.now();
      const t = (nowMs - start.current) / 1000;
      // liveline wants unix seconds.
      const now = nowMs / 1000;
      if (t >= LOOP_SECS) {
        setStory((s) => (s + 1) % STORIES.length);
        reset();
        return;
      }
      const p = phaseAt(t);

      // The stock drifts up a little, always. It is a stock.
      stockValue = step(stockValue, 0.0006, 0.006);
      setStock((d) => [...d, { time: now, value: stockValue }]);

      if (p === "live") {
        if (lastPhase === "before") narrativeValue = stockValue;
        // The narrative runs hotter: more drift, more noise.
        narrativeValue = step(narrativeValue, 0.004, 0.05);
        setNarrative((d) => [...d, { time: now, value: narrativeValue }]);
      } else if (p === "after" && lastPhase === "live") {
        // Expiry. The narrative is now the stock; its line stops here.
        frozen.current = narrativeValue;
      }

      if (p !== lastPhase) {
        lastPhase = p;
        setPhase(p);
      }
    }, TICK_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const s = STORIES[story];
  const ink = theme === "dark" ? "#b8b8b4" : "#4a4a48";
  const ochre = theme === "dark" ? "#e0993a" : "#b8741a";

  const series = useMemo<LivelineSeries[]>(() => {
    const out: LivelineSeries[] = [
      { id: "stock", data: stock, value: stock[stock.length - 1]?.value ?? STAKE, color: ink, label: s.stock },
    ];
    if (narrative.length > 0) {
      out.push({
        id: "narrative",
        data: narrative,
        value: frozen.current ?? narrative[narrative.length - 1]?.value ?? STAKE,
        color: ochre,
        label: `${s.narrative} narrative`,
      });
    }
    return out;
  }, [stock, narrative, ink, ochre, s]);

  const stockNow = stock[stock.length - 1]?.value ?? STAKE;
  const narrativeNow = frozen.current ?? narrative[narrative.length - 1]?.value ?? STAKE;

  return (
    <div className={`rounded bg-neutral-50 p-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs text-neutral-400">How a narrative goes</div>
        <div className="mono text-[11px] text-neutral-400">simulated</div>
      </div>

      {/* The caption is the story, one line per phase. Fixed height so the chart never jumps. */}
      <div className="mt-2 h-10 text-sm leading-snug">
        {phase === "before" ? (
          <span className="text-neutral-400">
            <span className="text-neutral-900">{s.stock}</span> trading on Solana. Nothing new.
          </span>
        ) : phase === "live" ? (
          <span className="text-neutral-400">
            <span className="text-neutral-900">{s.event}.</span> Someone launches{" "}
            <span className="text-accent">{s.narrative}</span> on it.
          </span>
        ) : (
          <span className="text-neutral-400">
            <span className="text-neutral-900">Date reached.</span> Every {s.narrative} token becomes{" "}
            {s.stock}. The stock carries on.
          </span>
        )}
      </div>

      <div className="mt-2 h-36">
        <Liveline
          data={stock}
          value={stockNow}
          series={series}
          theme={theme === "dark" ? "dark" : "light"}
          color={ink}
          window={WINDOW_SECS}
          grid={false}
          badge={false}
          momentum={false}
          showValue={false}
          fill={false}
          scrub={false}
          pulse={phase === "live"}
          lineWidth={1.5}
          formatValue={(v) => `$${v.toFixed(0)}`}
          padding={{ top: 8, right: 8, bottom: 4, left: 0 }}
        />
      </div>

      {/* Same $100 into each. This is the whole pitch in two numbers. */}
      <div className="mono mt-2 flex items-baseline justify-between text-xs">
        <span className="text-neutral-400">
          $100 in {s.ticker} <span className="text-neutral-900">${stockNow.toFixed(0)}</span>
        </span>
        <span className={narrative.length > 0 ? "text-neutral-400" : "text-neutral-300"}>
          $100 in {s.narrative}{" "}
          <span className={narrative.length > 0 ? "text-accent" : ""}>
            {narrative.length > 0 ? `$${narrativeNow.toFixed(0)}` : "—"}
          </span>
          {phase === "after" ? <span className="text-neutral-400"> in {s.stock}</span> : null}
        </span>
      </div>
    </div>
  );
}
