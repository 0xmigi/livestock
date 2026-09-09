"use client";

/**
 * Analytics: the protocol as numbers. Everything here is computed in the
 * browser from the same narrative accounts the markets page reads, plus a
 * 24-hour scan of each narrative's transaction history for volume and
 * movers. No indexer, nothing that is not on chain.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { secondsRemaining } from "@nm/client";

import { Shell } from "@/components/shell";
import { Thumb } from "@/components/thumb";
import { Delta, Overview, phaseOf, StockLogo, Tile } from "@/components/ui";
import { changeOf, fetchActivity, type Activity } from "@/lib/change";
import { formatUsd, type StockInfo } from "@/lib/config";
import { compact, marketCapOf, isLivePhase, usdOf, type PriceMap } from "@/lib/figures";
import { useStockMeta } from "@/lib/logos";
import { formatCountdown, useNarratives, useNow, type NarrativeRow } from "@/lib/narratives";
import { useStockChanges, useStockPrices } from "@/lib/price";

const WEEK = 7 * 24 * 3600;
const WEEKS = 8;

/** 24h activity for every narrative, filled in as the scans land. */
function useAllActivity(rows: NarrativeRow[] | null): Record<string, Activity> {
  const [map, setMap] = useState<Record<string, Activity>>({});
  const key = rows?.map((n) => `${n.address}:${n.supply}`).join(",") ?? "";
  useEffect(() => {
    if (!rows) return;
    let cancelled = false;
    for (const n of rows) {
      void fetchActivity(n.address, n).then((a) => {
        if (!cancelled) setMap((m) => ({ ...m, [n.address]: a }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}

export default function Analytics() {
  const { rows, error } = useNarratives();
  const now = useNow();
  const prices = useStockPrices();
  const changes = useStockChanges();
  const activity = useAllActivity(rows);
  const meta = useStockMeta();

  const data = useMemo(() => {
    if (!rows) return null;
    const live: NarrativeRow[] = [];
    const ended: NarrativeRow[] = [];
    for (const n of rows) {
      (isLivePhase(phaseOf(n.status, secondsRemaining(n, now))) ? live : ended).push(n);
    }
    let fdv = 0;
    let locked = 0;
    let soon = 0;
    for (const n of live) {
      fdv += marketCapOf(n, prices);
      locked += usdOf(n, n.vaultBalance, prices);
      if (secondsRemaining(n, now) < WEEK) soon++;
    }
    let paidOut = 0;
    for (const n of ended) paidOut += usdOf(n, n.finalVault, prices);

    let volume = 0;
    let trades = 0;
    let scanned = 0;
    for (const n of rows) {
      const a = activity[n.address];
      if (!a) continue;
      scanned++;
      volume += usdOf(n, a.volume, prices);
      trades += a.buys + a.sells;
    }

    // Launches per week, the last WEEKS weeks, oldest first.
    const launches = Array.from({ length: WEEKS }, () => 0);
    for (const n of rows) {
      const age = now - Number(n.createdTs);
      const w = Math.floor(age / WEEK);
      if (w >= 0 && w < WEEKS) launches[WEEKS - 1 - w]++;
    }
    // Dollars converting per week, the next WEEKS weeks, soonest first.
    const converting = Array.from({ length: WEEKS }, () => 0);
    for (const n of live) {
      const w = Math.floor(Math.max(0, secondsRemaining(n, now)) / WEEK);
      if (w < WEEKS) converting[w] += usdOf(n, n.vaultBalance, prices);
    }

    // By stock.
    const byStock = new Map<string, { stock: StockInfo; live: number; ended: number; locked: number; fdv: number }>();
    for (const n of rows) {
      const isLive = live.includes(n);
      const row = byStock.get(n.stockMint) ?? { stock: n.stock, live: 0, ended: 0, locked: 0, fdv: 0 };
      if (isLive) {
        row.live++;
        row.locked += usdOf(n, n.vaultBalance, prices);
        row.fdv += marketCapOf(n, prices);
      } else row.ended++;
      byStock.set(n.stockMint, row);
    }
    const stocks = [...byStock.values()].sort((a, b) => b.locked - a.locked || b.live - a.live);

    const traded = rows
      .map((n) => ({ n, a: activity[n.address] }))
      .filter((r): r is { n: NarrativeRow; a: Activity } => !!r.a && r.a.buys + r.a.sells > 0)
      .map((r) => ({ n: r.n, usd: usdOf(r.n, r.a.volume, prices), trades: r.a.buys + r.a.sells }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 5);
    const movers = live
      .map((n) => ({ n, change: changeOf(n, activity[n.address] ?? null, changes) }))
      .filter((r): r is { n: NarrativeRow; change: NonNullable<ReturnType<typeof changeOf>> } => r.change !== null)
      .sort((a, b) => Math.abs(b.change.pct) - Math.abs(a.change.pct))
      .slice(0, 5);

    return {
      live,
      ended,
      fdv,
      locked,
      soon,
      paidOut,
      volume,
      trades,
      scanning: scanned < rows.length,
      launches,
      converting,
      stocks,
      traded,
      movers,
    };
  }, [rows, now, prices, activity, changes]);

  const dash = "—";
  const d = data;

  return (
    <Shell>
      <div className="space-y-8">
        <div>
          <h1 className="display text-2xl text-neutral-900 sm:text-3xl">Analytics</h1>
          <p className="mt-1.5 text-sm text-neutral-400">
            Read from the chain. Dollars use the stocks&apos; live prices.
          </p>
          {error ? <p className="mt-2 text-sm text-danger">Could not reach the network: {error}</p> : null}
        </div>

        <Overview title="Right now" aside={d ? `${d.live.length + d.ended.length} narratives launched` : undefined}>
          <Tile label="Live narratives" value={d ? d.live.length : dash} sub={d ? `${d.soon} ending this week` : undefined} />
          <Tile label="Combined market cap" value={d ? compact(d.fdv) : dash} sub="across live narratives" />
          <Tile label="Locked in vaults" value={d ? compact(d.locked) : dash} sub="stock held for holders" />
          <Tile label="Paid out at expiry" value={d ? compact(d.paidOut) : dash} sub={d ? `${d.ended.length} narratives ended` : undefined} />
        </Overview>

        <Overview
          title="Last 24 hours"
          aside={d?.scanning ? "scanning trade history…" : undefined}
          columns={3}
        >
          <Tile label="Volume" value={d ? compact(d.volume) : dash} sub="through the vaults" />
          <Tile label="Trades" value={d ? d.trades : dash} sub="buys and sells" />
          <Tile
            label="Average trade"
            value={d && d.trades > 0 ? formatUsd(d.volume / d.trades, 0) : dash}
          />
        </Overview>

        <div className="grid gap-2 lg:grid-cols-2">
          <Bars
            title="Launches"
            aside={`last ${WEEKS} weeks`}
            values={d?.launches ?? []}
            labels={Array.from({ length: WEEKS }, (_, i) => (i === WEEKS - 1 ? "now" : `${WEEKS - 1 - i}w`))}
            format={(v) => `${v}`}
          />
          <Bars
            title="Converting to stock"
            aside={`next ${WEEKS} weeks, by vault`}
            values={d?.converting ?? []}
            labels={Array.from({ length: WEEKS }, (_, i) => (i === 0 ? "<1w" : `${i + 1}w`))}
            format={compact}
          />
        </div>

        <section className="rounded bg-neutral-50 p-2">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <span className="rounded bg-neutral-200 px-2.5 py-1 text-sm font-medium text-neutral-900">By stock</span>
            <span className="text-sm text-neutral-400">what the narratives convert into</span>
          </div>
          {d && d.stocks.length > 0 ? (
            <div className="overflow-hidden rounded bg-neutral-100">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200/60 text-left text-xs text-neutral-400">
                    <th className="px-4 py-2.5 font-medium">Stock</th>
                    <th className="px-4 py-2.5 text-right font-medium">Live</th>
                    <th className="px-4 py-2.5 text-right font-medium">Ended</th>
                    <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Market cap</th>
                    <th className="px-4 py-2.5 text-right font-medium">Locked</th>
                    <th className="hidden w-40 px-4 py-2.5 font-medium md:table-cell">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {d.stocks.map((s) => (
                    <tr key={s.stock.mint} className="border-b border-neutral-200/60 last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <StockLogo stock={s.stock} size={22} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-neutral-900">
                              {meta[s.stock.mint]?.name ?? s.stock.symbol}
                            </span>
                            <span className="mono block text-xs text-neutral-400">{s.stock.symbol}</span>
                          </span>
                        </span>
                      </td>
                      <td className="mono px-4 py-3 text-right text-sm text-neutral-900">{s.live}</td>
                      <td className="mono px-4 py-3 text-right text-sm text-neutral-400">{s.ended}</td>
                      <td className="mono hidden px-4 py-3 text-right text-sm text-neutral-900 sm:table-cell">{compact(s.fdv)}</td>
                      <td className="mono px-4 py-3 text-right text-sm font-semibold text-neutral-900">{compact(s.locked)}</td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                          <div
                            className="h-full rounded-full bg-neutral-600"
                            style={{ width: `${d.locked > 0 ? (s.locked / d.locked) * 100 : 0}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded bg-neutral-100 px-4 py-8 text-center text-sm text-neutral-400">
              {d ? "Nothing launched yet." : "Loading…"}
            </div>
          )}
        </section>

        <div className="grid gap-2 lg:grid-cols-2">
          <List
            title="Most traded"
            aside="24h volume"
            empty={d?.scanning ? "Scanning…" : "No trades in the last day."}
            rows={(d?.traded ?? []).map((r) => ({
              n: r.n,
              figure: compact(r.usd),
              sub: `${r.trades} trade${r.trades === 1 ? "" : "s"}`,
            }))}
          />
          <List
            title="Biggest movers"
            aside="24h price"
            empty={d?.scanning ? "Scanning…" : "Nothing moved in the last day."}
            rows={(d?.movers ?? []).map((r) => ({
              n: r.n,
              figure: <Delta pct={r.change.pct} approx={r.change.inStockTerms} className="text-sm font-semibold" />,
              sub: `${formatCountdown(secondsRemaining(r.n, now))} left`,
            }))}
          />
        </div>
      </div>
    </Shell>
  );
}

/** A small bar chart in the ink colour: one bar per bucket, figure on hover, label underneath. */
function Bars({
  title,
  aside,
  values,
  labels,
  format,
}: {
  title: string;
  aside: string;
  values: number[];
  labels: string[];
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <section className="rounded bg-neutral-50 p-2">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="rounded bg-neutral-200 px-2.5 py-1 text-sm font-medium text-neutral-900">{title}</span>
        <span className="text-sm text-neutral-400">{aside}</span>
      </div>
      <div className="rounded bg-neutral-100 px-4 pb-3 pt-4">
        <div className="mono mb-3 text-lg font-semibold text-neutral-900">{values.length ? format(total) : "—"}</div>
        <div className="flex h-28 items-end gap-1.5">
          {values.map((v, i) => (
            <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={format(v)}>
              <span className="mono text-[10px] text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100">
                {v > 0 ? format(v) : ""}
              </span>
              <div
                className="w-full rounded-sm bg-neutral-600 transition-colors group-hover:bg-neutral-900"
                style={{ height: `${Math.max(v > 0 ? 4 : 2, (v / max) * 100)}%`, opacity: v > 0 ? 1 : 0.25 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          {labels.map((l, i) => (
            <div key={i} className="mono flex-1 text-center text-[10px] text-neutral-400">
              {l}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function List({
  title,
  aside,
  empty,
  rows,
}: {
  title: string;
  aside: string;
  empty: string;
  rows: { n: NarrativeRow; figure: React.ReactNode; sub: string }[];
}) {
  return (
    <section className="rounded bg-neutral-50 p-2">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="rounded bg-neutral-200 px-2.5 py-1 text-sm font-medium text-neutral-900">{title}</span>
        <span className="text-sm text-neutral-400">{aside}</span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded bg-neutral-100 px-4 py-8 text-center text-sm text-neutral-400">{empty}</div>
      ) : (
        <ol className="overflow-hidden rounded bg-neutral-100">
          {rows.map((r, i) => (
            <li key={r.n.address}>
              <Link
                href={`/n/${r.n.address}`}
                className="flex items-center gap-3 border-b border-neutral-200/60 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-hover active:bg-press"
              >
                <span className="mono w-4 text-xs text-neutral-400">{i + 1}</span>
                <Thumb src={r.n.meta?.image} name={r.n.name} size={32} shape="square" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-900">{r.n.name}</span>
                  <span className="mono block text-xs text-neutral-400">{r.sub}</span>
                </span>
                <span className="mono shrink-0 text-sm font-semibold text-neutral-900">{r.figure}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
