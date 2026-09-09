"use client";

/**
 * Primitives. Every colour comes from the semantic neutral scale in
 * globals.css, so a component reads correctly on the dark and the light
 * ground without knowing which one it is on.
 */

import { Status } from "@nm/client";

import type { StockInfo } from "@/lib/config";
import { useStockMeta } from "@/lib/logos";

// --- text -----------------------------------------------------------------

/**
 * The one hero number a screen is allowed: a quiet label over a huge figure
 * with a caption.
 */
export function Hero({
  label,
  value,
  sub,
  muted = false,
  align = "center",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  muted?: boolean;
  align?: "center" | "left";
}) {
  const a = align === "center" ? "text-center" : "text-left";
  return (
    <div className={`space-y-1 ${a}`}>
      <p className="text-xs text-neutral-400">{label}</p>
      <p
        className={`numeric text-3xl font-semibold tracking-tight sm:text-4xl ${
          muted ? "text-neutral-300" : "text-neutral-900"
        }`}
      >
        {value}
      </p>
      {sub ? <p className="text-sm text-neutral-400">{sub}</p> : null}
    </div>
  );
}

// --- surfaces -------------------------------------------------------------

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded bg-neutral-50 p-4 sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/** A soft filled panel, for secondary information inside a card. */
export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded bg-neutral-100 px-4 py-3.5 ${className}`}>
      {children}
    </div>
  );
}

/**
 * A soft panel holding a grid of small tiles: a title pill and a quiet aside
 * on top, a 2×4 grid of label-over-figure tiles, one sentence underneath.
 */
export function Overview({
  title,
  aside,
  children,
  footer,
  columns = 4,
  className = "",
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  }[columns];
  return (
    <section className={`rounded bg-neutral-50 p-2.5 sm:p-3 ${className}`}>
      {title || aside ? (
        <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
          {title ? (
            <span className="rounded bg-neutral-200 px-2.5 py-1 text-sm font-medium text-neutral-900">
              {title}
            </span>
          ) : (
            <span />
          )}
          {aside ? (
            <span className="numeric min-w-0 truncate text-sm text-neutral-400">
              {aside}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={`grid gap-2 ${cols}`}>{children}</div>
      {footer ? (
        <div className="mt-3 px-1 pb-0.5 text-sm leading-relaxed text-neutral-400">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** One cell of an `Overview`: a quiet label over a bold figure. */
export function Tile({
  label,
  value,
  sub,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded bg-neutral-100 px-3 py-3 ${className}`}>
      <div className="truncate text-[13px] text-neutral-400">{label}</div>
      <div className="numeric mt-1 truncate text-base font-semibold tracking-tight text-neutral-900 sm:text-[17px]">
        {value}
      </div>
      {sub ? (
        <div className="numeric mt-0.5 text-xs leading-snug text-neutral-400">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded bg-neutral-50 px-6 py-14 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-neutral-300">
          {icon}
        </div>
      ) : null}
      <p className="display text-lg text-neutral-900">{title}</p>
      {body ? (
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-400">{body}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

// --- controls -------------------------------------------------------------

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "accent" | "buy" | "sell";
  size?: "sm" | "md" | "lg";
}) {
  const variants = {
    primary:
      "bg-primary text-on-primary hover:bg-primary-hover disabled:bg-neutral-200 disabled:text-neutral-400",
    accent:
      "bg-accent text-on-accent hover:bg-accent-hover disabled:bg-neutral-200 disabled:text-neutral-400",
    buy: "bg-buy text-white hover:bg-buy-hover disabled:bg-neutral-200 disabled:text-neutral-400",
    sell: "bg-danger-fill text-danger hover:brightness-110 disabled:bg-neutral-200 disabled:text-neutral-400",
    secondary:
      "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 disabled:text-neutral-400",
    outline:
      "bg-transparent text-neutral-900 hover:bg-neutral-50 disabled:text-neutral-400",
    ghost: "text-neutral-600 hover:text-neutral-900 disabled:text-neutral-400",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-3.5 py-1.5 text-sm",
    lg: "px-4 py-2.5 text-[15px]",
  };

  return (
    <button
      type="button"
      className={`rounded font-medium transition-[color,background-color,transform] active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Filter pill, with an optional count. */
export function Chip({
  active = false,
  icon,
  count,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded py-1.5 pl-3 pr-3 text-sm font-medium transition-colors ${
        active
          ? "bg-neutral-900 text-ground"
          : "bg-neutral-50 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900"
      } ${className}`}
      {...props}
    >
      {icon}
      {children}
      {count !== undefined ? (
        <span
          className={`mono rounded-full px-1.5 text-[11px] leading-4 ${
            active ? "bg-ground/20 text-ground" : "bg-neutral-200 text-neutral-400"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Underline tabs. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-6">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`-mb-px flex items-baseline gap-1.5 border-b-2 pb-3 pt-1 text-[15px] transition-colors ${
              active
                ? "border-neutral-900 font-semibold text-neutral-900"
                : "border-transparent font-medium text-neutral-400 hover:text-neutral-600"
            }`}
          >
            {o.label}
            {o.count !== undefined ? (
              <span
                className={`numeric text-xs ${active ? "text-neutral-500" : "text-neutral-300"}`}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A segmented control: two to four options, one active. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "h-7 px-2.5 text-xs" : "py-2 px-4 text-sm";
  return (
    <div className="flex gap-0.5 rounded">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-[3px] font-medium transition-colors ${pad} ${
            value === o.value
              ? "bg-neutral-200 text-neutral-900"
              : "text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-[15px] text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-300 focus-visible:outline-none";

export function Field({
  label,
  children,
  hint,
  optional = false,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-neutral-900">
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-neutral-400">optional</span>
        ) : null}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <span className="mt-1.5 block text-xs text-neutral-400">{hint}</span>
      ) : null}
    </label>
  );
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "error" | "info" | "success" | "warning";
  children: React.ReactNode;
}) {
  const styles = {
    error: "bg-danger-fill text-danger",
    info: "bg-neutral-100 text-neutral-600",
    success: "bg-success-fill text-success",
    warning: "bg-warn-fill text-neutral-900",
  };
  return (
    <div
      className={`rounded px-3.5 py-2.5 text-sm leading-relaxed ${styles[kind]}`}
    >
      {children}
    </div>
  );
}

// --- status ---------------------------------------------------------------

export type Phase = "live" | "closing" | "settling" | "redeemable" | "settled";

/** Collapses on-chain status plus the clock into what a person cares about. */
export function phaseOf(status: Status, secondsRemaining: number): Phase {
  if (status === Status.Settled) return "settled";
  if (status === Status.Expired) return "redeemable";
  if (secondsRemaining <= 0) return "settling";
  if (secondsRemaining < 24 * 3600) return "closing";
  return "live";
}

const PHASES: Record<Phase, { dot: string; text: string; label: string }> = {
  live: { dot: "bg-live", text: "text-neutral-600", label: "Live" },
  closing: { dot: "bg-live", text: "text-neutral-600", label: "Live" },
  settling: { dot: "bg-closing", text: "text-neutral-600", label: "Settling" },
  redeemable: { dot: "bg-accent", text: "text-neutral-600", label: "Redeemable" },
  settled: { dot: "bg-settled", text: "text-neutral-400", label: "Settled" },
};

export function StatusDot({
  phase,
  pulse = false,
  className = "",
}: {
  phase: Phase;
  pulse?: boolean;
  className?: string;
}) {
  const p = PHASES[phase];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${p.text} ${className}`}>
      <span className="relative flex h-2 w-2">
        {pulse && phase === "live" ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75" />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${p.dot}`} />
      </span>
      {p.label}
    </span>
  );
}

/**
 * The signature element: how much of a narrative's life has elapsed. Amber
 * is reserved for this and for state, nothing else on the page uses it.
 */
export function TimeBar({
  createdTs,
  expiryTs,
  now,
  phase,
  className = "",
}: {
  createdTs: bigint;
  expiryTs: bigint;
  now: number;
  phase: Phase;
  className?: string;
}) {
  const start = Number(createdTs);
  const end = Number(expiryTs);
  const total = Math.max(1, end - start);
  const elapsed = Math.min(1, Math.max(0, (now - start) / total));
  const done = phase === "settling" || phase === "redeemable" || phase === "settled";
  const fill = done ? "bg-neutral-300" : "bg-accent";
  return (
    <div
      className={`h-1 w-full overflow-hidden rounded-full bg-neutral-200 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(elapsed * 100)}
      aria-label="Time elapsed"
    >
      <div
        className={`h-full rounded-full ${fill}`}
        style={{ width: `${done ? 100 : elapsed * 100}%` }}
      />
    </div>
  );
}

/** A 24h move: green up, red down, grey flat. Colour is the only place gain and loss show. */
export function Delta({
  pct,
  approx = false,
  className = "",
}: {
  pct: number | null;
  approx?: boolean;
  className?: string;
}) {
  if (pct === null) return <span className={`mono text-neutral-400 ${className}`}>—</span>;
  const up = pct > 0.05;
  const down = pct < -0.05;
  const tone = up ? "text-success" : down ? "text-danger" : "text-neutral-400";
  const arrow = up ? "▲" : down ? "▼" : "";
  return (
    <span className={`mono ${tone} ${className}`} title={approx ? "In the underlying, not dollars" : "24h"}>
      {arrow ? <span className="mr-0.5 inline-block text-[0.55em] align-middle">{arrow}</span> : null}
      {Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%
    </span>
  );
}

// --- identity -------------------------------------------------------------

/** A deterministic soft colour for an address, used as an avatar. */
export function Avatar({
  seed,
  size = 24,
  className = "",
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue} 45% 70%), hsl(${(hue + 40) % 360} 40% 50%))`,
      }}
      aria-hidden="true"
    />
  );
}

/** A stock's logo from the token list, or a lettermark while none is known. */
export function StockLogo({
  stock,
  size = 20,
  className = "",
}: {
  stock: StockInfo;
  size?: number;
  className?: string;
}) {
  const meta = useStockMeta();
  const src = meta[stock.mint]?.icon;
  const letter = stock.symbol.replace(/x$/i, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 font-semibold text-neutral-600 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }}
      aria-hidden="true"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        letter
      )}
    </span>
  );
}
