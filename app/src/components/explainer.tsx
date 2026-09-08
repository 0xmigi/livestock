"use client";

/**
 * The hero's explainer: one narrative's life, on a loop, as a live chart.
 *
 * A stock ticks along. The story breaks, a narrative launches on it at
 * exactly the stock's price, and runs hotter. On its date it expires into
 * the stock; its line stops, the stock carries on. Then it starts again.
 *
 * Almost no words. The chart does the talking: one line of text for the
 * story, two numbers underneath. Keep it that way.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LivelinePoint, LivelineSeries } from "liveline";

import { useTheme } from "@/lib/theme";

const Liveline = dynamic(() => import("liveline").then((m) => m.Liveline), { ssr: false });

/** One loop, in seconds. */
const LOOP_SECS = 22;
/** When the story breaks and the narrative launches. */
const LAUNCH_AT = 5;
/** When the narrative expires into the stock. */
const EXPIRY_AT = 16;
const TICK_MS = 120;

/** Same $100 into each, so the two lines are directly comparable. */
const STAKE = 100;

const STOCK = "HOODx";
const NARRATIVE = "$HOODEU";
const STORY = "Robinhood opens tokenized stocks to the EU";

type Phase = "before" | "live" | "after";

function phaseAt(t: number): Phase {
  if (t < LAUNCH_AT) return "before";
  if (t < EXPIRY_AT) return "live";
  return "after";
}

/** A random walk with a drift, in fractions per tick. */
function step(value: number, drift: number, noise: number): number {
  return value * (1 + drift + (Math.random() - 0.5) * noise);
}

export function Explainer({ className = "" }: { className?: string }) {
  const { theme } = useTheme();
  const [phase, setPhase] = useState<Phase>("before");
  const [stock, setStock] = useState<LivelinePoint[]>([]);
  const [narrative, setNarrative] = useState<LivelinePoint[]>([]);
  const frozen = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let start = Date.now();
    let stockValue = STAKE;
    let narrativeValue = STAKE;
    let lastPhase: Phase = "before";

    const reset = () => {
      start = Date.now();
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
      const t = (nowMs - start) / 1000;
      if (t >= LOOP_SECS) {
        reset();
        return;
      }
      // liveline wants unix seconds.
      const now = nowMs / 1000;
      const p = phaseAt(t);

      // The stock drifts up a little, always. It is a stock.
      stockValue = step(stockValue, 0.0006, 0.006);
      setStock((d) => [...d, { time: now, value: stockValue }]);

      if (p === "live") {
        if (lastPhase === "before") {
          // Launch: the narrative starts at exactly the stock's price.
          narrativeValue = stockValue;
        } else {
          // Then runs hotter: more drift, more noise. A leveraged story.
          narrativeValue = step(narrativeValue, 0.004, 0.05);
        }
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

  const ink = theme === "dark" ? "#b8b8b4" : "#4a4a48";
  const ochre = theme === "dark" ? "#e0993a" : "#b8741a";

  const stockNow = stock[stock.length - 1]?.value ?? STAKE;
  const narrativeNow = frozen.current ?? narrative[narrative.length - 1]?.value ?? STAKE;

  const series = useMemo<LivelineSeries[]>(() => {
    const out: LivelineSeries[] = [{ id: "stock", data: stock, value: stockNow, color: ink, label: STOCK }];
    if (narrative.length > 0) {
      out.push({ id: "narrative", data: narrative, value: narrativeNow, color: ochre, label: NARRATIVE });
    }
    return out;
  }, [stock, narrative, stockNow, narrativeNow, ink, ochre]);

  return (
    <div className={`rounded bg-neutral-50 p-5 ${className}`}>
      {/* One line. Appears when the story breaks, stays for the rest of the loop. */}
      <div className="h-5 text-sm text-neutral-900">
        {phase === "before" ? null : STORY}
      </div>

      <div className="mt-3 h-40">
        <Liveline
          data={stock}
          value={stockNow}
          series={series}
          seriesToggleCompact
          theme={theme === "dark" ? "dark" : "light"}
          color={ink}
          window={LOOP_SECS}
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

      {/* Two numbers, far apart. Same $100 into each. */}
      <div className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <div className="mono text-[11px] text-neutral-400">$100 in {STOCK}</div>
          <div className="mono mt-1 text-2xl font-semibold leading-none text-neutral-900">${stockNow.toFixed(0)}</div>
        </div>
        <div>
          <div className="mono text-[11px] text-neutral-400">$100 in {NARRATIVE}</div>
          <div className={`mono mt-1 text-2xl font-semibold leading-none ${narrative.length > 0 ? "text-accent" : "text-neutral-300"}`}>
            {narrative.length > 0 ? `$${narrativeNow.toFixed(0)}` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
