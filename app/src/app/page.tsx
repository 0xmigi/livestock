"use client";

import Link from "next/link";
import {
  formatStock,
  isPastExpiry,
  isTradable,
  Status,
} from "@nm/client";

import { Card, Notice, Shell, StatusDot } from "@/components/ui";
import { ConnectButton } from "@/components/wallet";
import { STOCK_DECIMALS, STOCK_MINT, STOCK_SYMBOL } from "@/lib/config";
import {
  formatCountdown,
  useNarratives,
  useNow,
  type NarrativeRow,
} from "@/lib/narratives";

export default function Discover() {
  const { rows, error } = useNarratives();
  const now = useNow();

  const live = rows?.filter((n) => isTradable(n, now)) ?? [];
  const settling =
    rows?.filter((n) => n.status === Status.Live && isPastExpiry(n, now)) ?? [];
  const redeemable = rows?.filter((n) => n.status === Status.Expired) ?? [];
  const done = rows?.filter((n) => n.status === Status.Settled) ?? [];

  return (
    <Shell action={<ConnectButton />}>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Buy the story.
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            Short-lived tokens about one thing a company is doing. When they
            expire, you get {STOCK_SYMBOL}.
          </p>
        </div>

        {!STOCK_MINT ? (
          <Notice kind="error">
            <strong>No stock mint configured.</strong> Set{" "}
            <code>NEXT_PUBLIC_STOCK_MINT</code> in <code>app/.env.local</code>.
          </Notice>
        ) : error ? (
          <Notice kind="error">Could not reach the network: {error}</Notice>
        ) : rows === null ? (
          <p className="text-sm text-ink-faint">Loading…</p>
        ) : rows.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">
              Nothing here yet.{" "}
              <Link href="/create" className="underline underline-offset-4">
                Create the first narrative
              </Link>
              .
            </p>
          </Card>
        ) : (
          <>
            <Section title="Live" rows={live} now={now} />
            <Section title="Awaiting settlement" rows={settling} now={now} />
            <Section title="Redeemable" rows={redeemable} now={now} />
            <Section title="Settled" rows={done} now={now} />
          </>
        )}
      </div>
    </Shell>
  );
}

function Section({
  title,
  rows,
  now,
}: {
  title: string;
  rows: NarrativeRow[];
  now: number;
}) {
  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="label mb-3">{title}</h2>
      <div className="space-y-2">
        {rows.map((n) => (
          <Row key={n.address} narrative={n} now={now} />
        ))}
      </div>
    </section>
  );
}

function Row({ narrative, now }: { narrative: NarrativeRow; now: number }) {
  const tradable = isTradable(narrative, now);
  const remaining = Math.max(0, Number(narrative.expiryTs) - now);
  const backing =
    narrative.status === Status.Live
      ? narrative.vaultBalance
      : narrative.finalVault;

  return (
    <Link
      href={`/n/${narrative.address}`}
      className="block rounded-2xl border border-rule bg-white p-4 transition-colors hover:border-ink-faint sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-lg font-medium tracking-tight">
            {narrative.name}
          </div>
          <div className="mt-1">
            <StatusDot
              status={narrative.status}
              expired={isPastExpiry(narrative, now)}
            />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="numeric text-sm font-medium">
            {formatStock(backing, STOCK_DECIMALS, 2)}
            <span className="ml-1 text-xs font-normal text-ink-faint">
              {STOCK_SYMBOL}
            </span>
          </div>
          <div className="numeric mt-1 text-xs text-ink-faint">
            {tradable ? formatCountdown(remaining) : "closed"}
          </div>
        </div>
      </div>
    </Link>
  );
}
