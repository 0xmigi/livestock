"use client";

/**
 * The hero's explainer: one narrative's life, on a loop, as a live chart.
 *
 * A stock ticks along. A post lands, a narrative launches on it at exactly
 * the stock's price, and runs hotter. An expiry countdown ticks down; on
 * the date the narrative line ends: the whole supply is stock now, and the
 * number underneath follows the stock from where the narrative left it.
 * Then it starts again.
 * Seeded, so every loop is the same picture.
 *
 * Almost no words. The chart does the talking: the post, two numbers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Liveline, type LivelinePoint, type LivelineSeries } from "liveline";

import { formatUsdCompact } from "@/lib/config";
import { useStocks } from "@/lib/stocks";
import { useTheme } from "@/lib/theme";

/** One loop, in seconds. */
const LOOP_SECS = 30;
/** How far into the loop the page opens, so the chart is never empty. */
const OPEN_AT = 3;
/** When the post lands and the narrative launches. */
const LAUNCH_AT = 6;
/** When the narrative expires into the stock. */
const EXPIRY_AT = 21;
const TICK_MS = 120;
/** Seconds after launch before the third beat lands. */
const LAUNCH_BEAT_SECS = 2.5;
const TICKS = { launch: (LAUNCH_AT * 1000) / TICK_MS, expiry: (EXPIRY_AT * 1000) / TICK_MS, loop: (LOOP_SECS * 1000) / TICK_MS };

/** Same $100 into each, so the two lines are directly comparable. */
const STAKE = 100;
/** The creator's fee on every buy, as in the program (FEE_BPS = 100). */
const FEE = 0.01;

/**
 * The y-range is pinned (see the "range" series) so the overlay can map
 * values to pixels the same way liveline does: liveline pads the range by
 * 12% each side, keeps its live head 1.5% of the window left of the plot's
 * right edge, and uses this padding.
 */
const RANGE_MIN = 96;
const RANGE_MAX = 150;
const RANGE_MARGIN = 0.12;
const HEAD_BUFFER = 0.015;
/** The right padding is the future: the expiry line travels through it toward the live head. Less of it on a phone. */
function padFor(width: number) {
  return { top: 8, right: width > 0 && width < 520 ? 84 : 150, bottom: 4, left: 0 };
}

const STOCK = "TSLAx";
const NARRATIVE = "$ROBOTAXI";
const POST = { name: "Elon Musk", handle: "@elonmusk", text: "Robotaxi nationwide. Soon." };

/**
 * Seeded, so the chart is the same picture every loop. A different chart
 * each time reads as noise; the same one reads as the story.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 12;

type Phase = "before" | "live" | "after";

function canvasPixels(boxEl: HTMLDivElement | null) {
  const canvas = boxEl?.querySelector("canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return null;
  const scale = w / canvas.getBoundingClientRect().width;
  return { img: ctx.getImageData(0, 0, w, h).data, w, h, scale };
}

/** The narrative's green, solid: opaque, with green clearly above red and blue. */
function isGreen(img: Uint8ClampedArray, i: number): boolean {
  return img[i + 3] > 200 && img[i + 1] > img[i] + 40 && img[i + 1] > img[i + 2] + 30;
}

/**
 * Reads the narrative off liveline's canvas: the live dot (rightmost solid
 * green, its centre row averaged across the dot) and the launch point (the
 * leftmost solid green). Those two, with their known times, give liveline's
 * exact time-to-x mapping without knowing anything about its internals.
 */
function measureNarrative(boxEl: HTMLDivElement | null): { dotX: number; dotY: number; leftX: number } | null {
  const px = canvasPixels(boxEl);
  if (!px) return null;
  const { img, w, h, scale } = px;
  let dot = -1;
  let left = -1;
  for (let x = w - 1; x >= 0 && dot < 0; x--) {
    for (let y = 0; y < h; y++) {
      if (isGreen(img, (y * w + x) * 4)) { dot = x; break; }
    }
  }
  if (dot < 0) return null;
  for (let x = 0; x < w && left < 0; x++) {
    for (let y = 0; y < h; y++) {
      if (isGreen(img, (y * w + x) * 4)) { left = x; break; }
    }
  }
  let rows = 0, cnt = 0;
  for (let c = Math.max(0, dot - 6); c <= dot; c++) {
    for (let y = 0; y < h; y++) {
      if (isGreen(img, (y * w + c) * 4)) { rows += y; cnt++; }
    }
  }
  return { dotX: (dot - 3) / scale, dotY: (cnt ? rows / cnt : 0) / scale, leftX: left / scale };
}

function phaseAt(tick: number): Phase {
  if (tick < TICKS.launch) return "before";
  if (tick < TICKS.expiry) return "live";
  return "after";
}

/** A random walk with a drift, in fractions per tick. */
function step(random: () => number, value: number, drift: number, noise: number): number {
  return value * (1 + drift + (random() - 0.5) * noise);
}

export function Explainer({ className = "" }: { className?: string }) {
  const { theme } = useTheme();
  const [phase, setPhase] = useState<Phase>("before");
  /** At expiry: the chart's $100 in the narrative, as stock, over a straight buy's. See the tick loop. */
  const [multiple, setMultiple] = useState<number | null>(null);
  const [stock, setStock] = useState<LivelinePoint[]>([]);
  const [narrative, setNarrative] = useState<LivelinePoint[]>([]);
  /** Seconds into the loop, for the countdown. */
  const [t, setT] = useState(0);
  /** Real clock, ticking with the chart, for the dashed line's position. */
  const [clock, setClock] = useState(0);
  /** Where liveline drew the narrative this frame, in box pixels. */
  const [head, setHead] = useState<{ dotX: number; dotY: number; leftX: number } | null>(null);
  const headRef = useRef<{ dotX: number; dotY: number; leftX: number } | null>(null);
  const outliers = useRef(0);
  /** Wall-clock time of the last tick, so the expiry line moves smoothly between ticks. */
  const tickAt = useRef(0);
  /**
   * Counts loops. liveline keeps a smoothed head value per series id, and
   * once that has been NaN (see `stopped`) it never recovers, so a fresh id
   * each loop is what lets the narrative's dot and label draw again.
   */
  const [loop, setLoop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("before");

  useEffect(() => {
    let alive = true;
    let tick = 0;
    let stockValue = STAKE;
    let anchor = STAKE;
    let narrativeValue = STAKE;
    let ratioSum = 0;
    let ratioCount = 0;
    let lastPhase: Phase = "before";
    let random = rng(SEED);

    const reset = () => {
      tick = 0;
      stockValue = STAKE;
      anchor = STAKE;
      narrativeValue = STAKE;
      random = rng(SEED);
      lastPhase = "before";
      setStock([]);
      setNarrative([]);
      phaseRef.current = "before";
      setPhase("before");
      setT(0);
      setLoop((n) => n + 1);
    };
    reset();

    // One tick of the story at a given unix time (liveline wants seconds).
    const advance = (now: number) => {
      tick += 1;
      tickAt.current = now;
      setT((tick * TICK_MS) / 1000);
      const p = phaseAt(tick);

      // The stock has a normal day: it wanders a few percent (a large
      // stock's daily range is 3-5%) but is pulled back toward a barely
      // drifting anchor, so it moves without trending away. A small bump
      // when the post lands; the narrative absorbs most of the reaction.
      anchor *= 1 + 0.00003;
      const pull = ((anchor - stockValue) / stockValue) * 0.04;
      const bump = tick >= TICKS.launch && tick < TICKS.launch + 12 ? 0.0035 : 0;
      stockValue = step(random, stockValue, pull + bump, 0.013);
      setStock((d) => [...d, { time: now, value: stockValue }]);

      if (p === "live") {
        if (lastPhase === "before") {
          // Launch: the narrative starts at exactly the stock's price.
          narrativeValue = stockValue;
        } else {
          // Then runs hot while the story is fresh, dwindles as it ages, and
          // sells off into expiry. A leveraged story with a clock on it.
          const age = (tick - TICKS.launch) / (TICKS.expiry - TICKS.launch);
          const drift = age < 0.55 ? 0.0065 : age < 0.8 ? -0.0005 : -0.003;
          narrativeValue = step(random, narrativeValue, drift, 0.014);
        }
        setNarrative((d) => [...d, { time: now, value: narrativeValue }]);
        ratioSum += narrativeValue / stockValue;
        ratioCount += 1;
      } else if (p === "after" && lastPhase === "live") {
        // What the $100 shown on the chart (bought at launch) actually ends
        // up with, in stock, next to a straight buy of the stock at the same
        // moment. Never say "early buyer": the point is the mechanism, not
        // who got in first. At expiry every token
        // redeems for its share of the vault, and the vault holds what all
        // buyers paid in (less the 1% fee), so a token is worth the average
        // price paid, not the last price. With buying spread evenly over the
        // token's life that average is the mean of its price in stock terms.
        // No sells are modelled; sells would leave their 10% exit tax behind
        // and raise this slightly.
        setMultiple((1 - FEE) * (ratioSum / ratioCount));
      }
      // After expiry nothing more happens to the narrative. liveline keeps
      // drawing it flat out to the live tip; the overlay covers that stretch
      // from the expiry point on, so the line reads as stopped there.

      if (p !== lastPhase) {
        lastPhase = p;
        phaseRef.current = p;
        setPhase(p);
      }
    };

    // The loop opens a few seconds in, so there is a line on the chart from
    // the first frame rather than a dot growing out of nothing. Dev: `?at=19`
    // opens it 19 seconds in, so a moment like expiry can be checked without
    // waiting for it.
    const asked = Number(new URLSearchParams(window.location.search).get("at"));
    const at = Number.isFinite(asked) && asked > 0 ? asked : OPEN_AT;
    if (at > 0) {
      const ticks = Math.min(TICKS.loop - 1, Math.floor((at * 1000) / TICK_MS));
      const nowSec = Date.now() / 1000;
      for (let i = 1; i <= ticks; i++) advance(nowSec - ((ticks - i) * TICK_MS) / 1000);
    }

    const timer = setInterval(() => {
      if (!alive) return;
      if (tick >= TICKS.loop) {
        reset();
        return;
      }
      advance(Date.now() / 1000);
    }, TICK_MS);

    let raf = 0;
    const clockTick = () => {
      setClock(Date.now() / 1000);
      if (phaseRef.current !== "before") {
        // Sticky: a frame that yields nothing keeps the last reading, and a
        // single-frame outlier (more than 12px from the last dot) is ignored
        // unless it persists, so one bad scan cannot make anything jump.
        const m = measureNarrative(box.current);
        const last = headRef.current;
        if (m && (!last || Math.abs(m.dotX - last.dotX) <= 12 || outliers.current >= 4)) {
          headRef.current = m;
          outliers.current = 0;
          setHead(m);
        } else if (m) {
          outliers.current += 1;
        }
      } else if (headRef.current) {
        headRef.current = null;
        outliers.current = 0;
        setHead(null);
      }
      raf = requestAnimationFrame(clockTick);
    };
    raf = requestAnimationFrame(clockTick);

    return () => {
      alive = false;
      clearInterval(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  // The story in words, one beat at a time, timed to the chart. Only the
  // current beat is shown. Numbers come from the registry and the
  // simulation, never typed in, so they cannot disagree with the chart.
  const { stocks } = useStocks();
  const cap = stocks.find((s) => s.symbol.toUpperCase() === STOCK.toUpperCase())?.marketCapUsd;
  const BEATS = [
    <>
      <span className="text-neutral-900">{STOCK}</span> trades on Solana
      {cap ? <>, {formatUsdCompact(cap)} on chain</> : null}.
    </>,
    null, // The post itself stands in for this beat.
    <>
      Someone launches <span className="text-neutral-900">{NARRATIVE}</span> on {STOCK}, two-week expiry.
    </>,
    <>
      That $100 in {NARRATIVE} redeems for{" "}
      <span className="text-neutral-900">{multiple ? `${multiple.toFixed(1)}×` : "more"}</span> the {STOCK} a
      straight buy got.
    </>,
  ];
  const beat = phase === "before" ? 0 : phase === "live" ? (t < LAUNCH_AT + LAUNCH_BEAT_SECS ? 1 : 2) : 3;

  const ink = theme === "dark" ? "#b8b8b4" : "#4a4a48";
  // The narrative is green: it is the line that goes up, and green already
  // means gain in this app. The brand ochre stays out of the chart.
  const green = theme === "dark" ? "#21c95e" : "#0a9c4f";

  const stockNow = stock[stock.length - 1]?.value ?? STAKE;
  // Dev: expose the story's state for inspection from the console.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    (window as unknown as { __explainer: unknown }).__explainer = { narrative, stock, phase, clock, head };
  }
  const narrativeLast = narrative[narrative.length - 1]?.value ?? STAKE;

  // An invisible series pins the y-range (96 to 150 on a $100 stake), so
  // the stock's few-percent day is drawn at its true size next to the
  // narrative instead of being stretched to fill the chart.
  // Anchored to the latest point, so it never scrolls out of the window.
  const range = useMemo<LivelinePoint[]>(() => {
    const t1 = stock[stock.length - 1]?.time ?? Date.now() / 1000;
    return [
      { time: t1 - 0.001, value: RANGE_MIN },
      { time: t1, value: RANGE_MAX },
    ];
  }, [stock]);

  // liveline draws both lines. The narrative series is always present so the
  // series list never changes shape when it launches. After expiry its head
  // value is NaN on purpose: liveline then draws nothing past the last real
  // point, so the line stops. Where it stopped is read back off the canvas
  // (see measureEnd) and the expiry line, label and notice are put there.
  const series = useMemo<LivelineSeries[]>(
    () => [
      { id: "range", data: range, value: RANGE_MAX, color: "transparent", label: "" },
      { id: "stock", data: stock, value: stockNow, color: ink, label: STOCK },
      {
        id: `narrative-${loop}`,
        data: narrative,
        value: narrativeLast,
        color: green,
        // No label from liveline: its letters would confuse the head scan
        // (see measureHead). The overlay draws the label at the dot instead.
        label: "",
      },
    ],
    [range, stock, narrative, loop, stockNow, narrativeLast, ink, green],
  );


  // The overlay. Same mapping as liveline, so the narrative line, its label,
  // the expiry line and the notice all agree to the pixel.
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The expiry line is a point in time on liveline's own axis. That axis is
  // read off the canvas: the live dot is "now" and the leftmost green is the
  // launch point, whose time is known, so pixels per second follows. Ahead
  // of expiry the line sits in the future, right of the dot, and slides in;
  // from the expiry tick on it stands on the last live point, which scrolls
  // left with everything else.
  const PAD = padFor(size.w);
  const narrow = size.w > 0 && size.w < 520;
  const plotW = Math.max(0, size.w - PAD.left - PAD.right);
  const fallbackDot = PAD.left + plotW * (1 - HEAD_BUFFER);
  const launchTime = narrative[0]?.time ?? null;
  const lastTime = narrative[narrative.length - 1]?.time ?? clock;
  const dotX = head?.dotX ?? fallbackDot;
  const measuredSpeed =
    head && launchTime !== null && clock - launchTime > 1 ? (head.dotX - head.leftX) / (clock - launchTime) : null;
  const pxPerSec = measuredSpeed && measuredSpeed > 0 ? measuredSpeed : plotW / LOOP_SECS;
  const sinceTick = Math.max(0, clock - tickAt.current);
  const secsAhead = Math.max(0, EXPIRY_AT - t - sinceTick);
  const approachX = phase === "live" && dotX + secsAhead * pxPerSec < size.w ? dotX + secsAhead * pxPerSec : null;
  const stoppedX = head && launchTime !== null ? head.leftX + (lastTime - launchTime) * pxPerSec : dotX;
  const expiryX = phase === "after" ? stoppedX : approachX;
  const stopped = phase === "after" && head !== null;
  return (
    <div className={`relative min-w-0 overflow-hidden rounded bg-neutral-50 p-5 ${className}`}>
      {/* So nobody reads it as live data. */}
      <div className="mono pointer-events-none absolute left-5 top-4 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
        example
      </div>
      <div ref={box} className="explainer-chart relative h-48 w-full min-w-0">
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
          padding={PAD}
        />

        {/* The expiry line: sliding in from the future while live, standing on the last live point after. */}
        {expiryX !== null && size.w > 0 ? (
          <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden>
            {stopped && head ? (
              // liveline keeps the stopped narrative flat out to the live tip.
              // A band in the card's colour hides that stretch from the
              // expiry point on, so the line ends where it should.
              <rect x={expiryX + 0.5} y={head.dotY - 8} width={Math.max(0, size.w - expiryX)} height={16} fill="var(--n50)" />
            ) : null}
            <line x1={expiryX} y1={0} x2={expiryX} y2={size.h} stroke={ink} strokeOpacity={0.45} strokeDasharray="3 3" />
            {stopped && head ? (
              <>
                <circle cx={expiryX} cy={head.dotY} r={2.5} fill={green} />
                <text x={expiryX + 8} y={head.dotY + 3.5} fontSize={10} fontFamily="ui-monospace, Menlo, monospace" fill={green}>
                  {NARRATIVE}
                </text>
              </>
            ) : null}
          </svg>
        ) : null}
        {expiryX !== null && !stopped ? (
          <div className="mono pointer-events-none absolute top-0 text-[11px] text-neutral-400" style={{ left: expiryX + 6 }}>
            expiry
          </div>
        ) : null}
        {/* On a phone the label is shorter and sits a line lower, clear of the "example" tag. */}
        {stopped && expiryX !== null ? (
          <div
            className="mono pointer-events-none absolute whitespace-nowrap text-[11px] leading-tight"
            style={{
              top: narrow ? 14 : 0,
              ...(expiryX > size.w - 220 ? { right: size.w - expiryX + 6, textAlign: "right" } : { left: expiryX + 6 }),
            }}
          >
            <span className="block text-neutral-400">expired</span>
            <span className="block text-neutral-900">{narrow ? `converted to ${STOCK}` : `all ${NARRATIVE} converted to ${STOCK}`}</span>
          </div>
        ) : null}
        {/* The narrative's label while it is live, at liveline's own dot. */}
        {phase === "live" && head ? (
          <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden>
            <text x={head.dotX + 8} y={head.dotY + 3.5} fontSize={10} fontFamily="ui-monospace, Menlo, monospace" fill={green}>
              {NARRATIVE}
            </text>
          </svg>
        ) : null}
      </div>

      {/* Underneath: the two numbers, and the story beside them. Nothing above the chart. */}
      <div className="mt-5 flex flex-col gap-3 sm:h-11 sm:flex-row sm:items-center sm:gap-10">
        <div className="flex h-11 shrink-0 gap-10">
        <div>
          <div className="mono text-[11px] text-neutral-400">$100 in {STOCK}</div>
          <div className="mono mt-1 text-2xl font-semibold leading-none text-neutral-900">${stockNow.toFixed(0)}</div>
        </div>
        {/* Only while the token is live. Before, it does not exist; after, it is stock. The slot keeps its width. */}
        <div className={`min-w-[7.5rem] ${phase === "live" ? "" : "invisible"}`} aria-hidden={phase !== "live"}>
          <div className="mono text-[11px] text-neutral-400">$100 in {NARRATIVE}</div>
          <div className="mono mt-1 text-2xl font-semibold leading-none text-success">${narrativeLast.toFixed(0)}</div>
        </div>
        </div>

        {/* One beat at a time. The post is the second beat. Fixed height so nothing shifts. */}
        {/* A rule marks where each beat lands; the sentences are italic, the post is not. */}
        <div key={beat} className="explainer-beat flex h-10 min-w-0 flex-1 items-center border-l-2 border-neutral-200 pl-4 sm:h-full">
          {beat === 1 ? (
            <div className="flex items-center gap-4">
              <p className="shrink-0 text-sm italic leading-snug text-neutral-600">Elon posts</p>
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
                {POST.name[0]}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-xs leading-tight">
                  <span className="font-semibold text-neutral-900">{POST.name}</span>
                  <svg viewBox="0 0 22 22" className="h-3.5 w-3.5 shrink-0 fill-[#1d9bf0]" aria-label="Verified">
                    <path d="M20.4 11c0-1.2-.7-2.3-1.7-2.8.3-1.1 0-2.3-.9-3.1-.8-.8-2-1.1-3.1-.9C14.2 3.2 13.1 2.5 11.9 2.5s-2.3.7-2.8 1.7c-1.1-.3-2.3 0-3.1.9-.8.8-1.1 2-.9 3.1-1 .5-1.7 1.6-1.7 2.8s.7 2.3 1.7 2.8c-.3 1.1 0 2.3.9 3.1.8.8 2 1.1 3.1.9.5 1 1.6 1.7 2.8 1.7s2.3-.7 2.8-1.7c1.1.3 2.3 0 3.1-.9.8-.8 1.1-2 .9-3.1 1-.5 1.7-1.6 1.7-2.8zm-9.6 4.3L7.4 12l1.4-1.4 2 2 4.4-4.4 1.4 1.4-5.8 5.7z" />
                  </svg>
                  <span className="ml-0.5 text-neutral-400">{POST.handle}</span>
                </span>
                <span className="block text-sm leading-snug text-neutral-900">{POST.text}</span>
              </span>
            </div>
            </div>
          ) : (
            <p className="text-sm italic leading-snug text-neutral-600">{BEATS[beat]}</p>
          )}
        </div>
      </div>
    </div>
  );
}
