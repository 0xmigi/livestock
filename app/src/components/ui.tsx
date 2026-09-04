"use client";

/**
 * Primitives, styled after the Moment app: white ground, warm neutrals,
 * `rounded-lg` controls, `rounded-xl` cards, one amber accent.
 */

import { Status } from "@nm/client";

// --- text -----------------------------------------------------------------

/** Uppercase, letter-spaced micro-label. Sits above a number. */
export function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`label ${className}`}>{children}</div>;
}

/** A small label over a medium number — the page's core unit. */
export function Stat({
  label,
  value,
  sub,
  align = "left",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  align?: "left" | "center";
}) {
  const alignment = align === "center" ? "text-center" : "";
  return (
    <div className={alignment}>
      <div className="text-xs uppercase tracking-widest text-neutral-400">
        {label}
      </div>
      <div className="numeric mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-neutral-400">{sub}</div> : null}
    </div>
  );
}

/**
 * The one hero number a screen is allowed. Copied from Moment's home:
 * `TIME IN THE MOMENT` over a huge bold figure with a quiet caption.
 */
export function Hero({
  label,
  value,
  sub,
  muted = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-sm uppercase tracking-widest text-neutral-400">
        {label}
      </p>
      <p
        className={`numeric text-4xl font-bold tracking-tight sm:text-5xl ${
          muted ? "text-neutral-200" : "text-neutral-900"
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
      className={`rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 ${className}`}
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
    <div className={`rounded-xl bg-neutral-50 px-4 py-3.5 ${className}`}>
      {children}
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
    <div className="rounded-xl bg-neutral-50 px-6 py-10 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-neutral-300">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-medium text-neutral-900">{title}</p>
      {body ? (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-400">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
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
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}) {
  const variants = {
    primary:
      "bg-primary text-white hover:bg-primary-hover disabled:bg-neutral-300",
    secondary:
      "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 disabled:text-neutral-400",
    outline:
      "bg-white text-neutral-900 border border-neutral-200 hover:bg-neutral-50 disabled:text-neutral-400",
    ghost: "text-neutral-600 hover:text-neutral-900 disabled:text-neutral-400",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-4 py-3 text-sm",
  };

  return (
    <button
      type="button"
      className={`rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Filter chip, as on Moment's Gallery and Activities screens. */
export function Chip({
  active = false,
  icon,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm transition-colors ${
        active
          ? "bg-neutral-200 font-semibold text-neutral-900"
          : "bg-neutral-100 font-medium text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
      } ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/** Underline tabs — the primary switch on a list screen. */
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
    <div className="flex gap-6 border-b border-neutral-200">
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

/** A segmented control: two or three options, one active. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-neutral-100 p-1 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg py-2.5 font-semibold transition-colors ${
            value === o.value
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-neutral-400 hover:text-neutral-600"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-[15px] text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
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
    error: "border-red-200 bg-red-50 text-red-900",
    info: "border-neutral-200 bg-neutral-50 text-neutral-600",
    success: "border-green-200 bg-green-50 text-green-900",
    warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
  };
  return (
    <div
      className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${styles[kind]}`}
    >
      {children}
    </div>
  );
}

// --- status ---------------------------------------------------------------

export type Phase = "live" | "closing" | "settling" | "redeemable" | "settled";

/** Collapses on-chain status plus the clock into what a person cares about. */
export function phaseOf(
  status: Status,
  secondsRemaining: number,
): Phase {
  if (status === Status.Settled) return "settled";
  if (status === Status.Expired) return "redeemable";
  if (secondsRemaining <= 0) return "settling";
  if (secondsRemaining < 24 * 3600) return "closing";
  return "live";
}

const PHASES: Record<Phase, { dot: string; text: string; label: string }> = {
  live: { dot: "bg-live", text: "text-neutral-600", label: "Live" },
  closing: { dot: "bg-closing", text: "text-neutral-600", label: "Expiring soon" },
  settling: {
    dot: "bg-closing",
    text: "text-neutral-600",
    label: "Awaiting settlement",
  },
  redeemable: { dot: "bg-accent", text: "text-neutral-600", label: "Redeemable" },
  settled: { dot: "bg-settled", text: "text-neutral-400", label: "Settled" },
};

export function StatusDot({
  phase,
  pulse = false,
}: {
  phase: Phase;
  pulse?: boolean;
}) {
  const p = PHASES[phase];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${p.text}`}>
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
        background: `linear-gradient(135deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 60%))`,
      }}
      aria-hidden="true"
    />
  );
}
