"use client";

import Link from "next/link";
import { Status } from "@nm/client";

/** A small uppercase label over a large number. The page's core unit. */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "muted";
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={`numeric mt-1.5 text-2xl font-medium tracking-tight ${
          tone === "muted" ? "text-ink-faint" : ""
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-xs text-ink-faint">{sub}</div>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-rule bg-white p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatusDot({ status, expired }: { status: Status; expired?: boolean }) {
  const [color, text] =
    status === Status.Settled
      ? ["bg-settled", "Settled"]
      : status === Status.Expired
        ? ["bg-closing", "Redeemable"]
        : expired
          ? ["bg-closing", "Awaiting settlement"]
          : ["bg-live", "Live"];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {text}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const variants = {
    primary:
      "bg-ink text-white hover:bg-black disabled:bg-ink-faint",
    secondary:
      "bg-fill text-ink hover:bg-rule disabled:text-ink-faint",
    ghost:
      "text-ink-soft hover:text-ink disabled:text-ink-faint",
  };

  return (
    <button
      className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "error" | "info" | "success";
  children: React.ReactNode;
}) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-900",
    info: "border-rule bg-fill text-ink-soft",
    success: "border-green-200 bg-green-50 text-green-900",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles[kind]}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-2">{children}</div>
      {hint ? (
        <span className="mt-1.5 block text-xs text-ink-faint">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-rule bg-white px-4 py-3 text-sm outline-none transition-colors placeholder:text-ink-faint focus:border-ink";

export function Shell({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-5 pb-24 pt-6 sm:pt-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <nav className="flex items-baseline gap-5">
          <Link href="/" className="text-[15px] font-semibold tracking-tight">
            Narrative
          </Link>
          <Link
            href="/create"
            className="text-sm text-ink-faint transition-colors hover:text-ink"
          >
            Create
          </Link>
        </nav>
        {action}
      </header>
      {children}
    </div>
  );
}
