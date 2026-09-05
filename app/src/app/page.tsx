"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Plus, Search, Sprout } from "lucide-react";
import { formatStock, redemptionPerToken, secondsRemaining, spotPrice } from "@nm/client";

import { Shell } from "@/components/shell";
import { Thumb } from "@/components/thumb";
import {
  Button,
  Delta,
  EmptyState,
  Notice,
  phaseOf,
  Segmented,
  StatusDot,
  StockLogo,
  TimeBar,
  type Phase,
} from "@/components/ui";
import { formatUsd, formatUsdAuto, STOCKS } from "@/lib/config";
import { usePriceChange } from "@/lib/change";
import { useStockMeta } from "@/lib/logos";
import {
  formatCountdown,
  formatDate,
  useNarratives,
  useNow,
  type NarrativeRow,
} from "@/lib/narratives";
import { useStockPrices } from "@/lib/price";

type View = "live" | "ended";
type Sort = "fdv" | "new";

const PAGE = 20;
const WEEK = 7 * 24 * 3600;

function isLivePhase(phase: Phase): boolean {
  return phase === "live" || phase === "closing";
}

function backingOf(n: NarrativeRow, phase: Phase): bigint {
  return isLivePhase(phase) || phase === "settling" ? n.vaultBalance : n.finalVault;
}

function priceOf(n: NarrativeRow, prices: Record<string, number>): number {
  return prices[n.stockMint] ?? n.stock.fallbackPriceUsd;
}

function usdOf(n: NarrativeRow, units: bigint, prices: Record<string, number>): number {
  return (Number(units) / 10 ** n.stock.decimals) * priceOf(n, prices);
}

/** What the next token costs, in dollars. */
function tokenPriceOf(n: NarrativeRow, prices: Record<string, number>): number {
  return usdOf(n, spotPrice(n.supply, n), prices);
}

/** Spot price times supply, the number every launchpad leads with. */
function fdvOf(n: NarrativeRow, prices: Record<string, number>): number {
  const supply = n.status === 0 ? n.supply : n.finalSupply;
  return usdOf(n, spotPrice(n.supply, n) * supply, prices);
}

/** `3h ago`, `2d ago`. */
function formatAgo(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function compact(usd: number): string {
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(usd >= 1e7 ? 0 : 1)}M`;
  if (usd >= 1e4) return `$${(usd / 1e3).toFixed(0)}k`;
  return formatUsd(usd, 0);
}

export default function Markets() {
  const { rows, error } = useNarratives();
  const now = useNow();
  const prices = useStockPrices();

  const [view, setView] = useState<View>("live");
  const [sort, setSort] = useState<Sort>("fdv");
  const [stockFilter, setStockFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // A new filter starts the list from the top again.
  useEffect(() => setLimit(PAGE), [view, sort, stockFilter, query]);

  const live = useMemo(
    () => (rows ?? []).filter((n) => isLivePhase(phaseOf(n.status, secondsRemaining(n, now)))),
    [rows, now],
  );

  const stats = useMemo(() => {
    let locked = 0;
    let fdv = 0;
    let soon = 0;
    for (const n of live) {
      locked += usdOf(n, n.vaultBalance, prices);
      fdv += fdvOf(n, prices);
      if (secondsRemaining(n, now) < WEEK) soon++;
    }
    return { launched: rows?.length ?? 0, live: live.length, locked, fdv, soon };
  }, [rows, live, prices, now]);

  const features = useMemo(() => {
    if (live.length === 0) return null;
    const byFdv = [...live].sort((a, b) => fdvOf(b, prices) - fdvOf(a, prices));
    const byExpiry = [...live].sort((a, b) => Number(a.expiryTs - b.expiryTs));
    const byNew = [...live].sort((a, b) => Number(b.createdTs - a.createdTs));
    return { newest: byNew[0], top: byFdv[0], soonest: byExpiry[0] };
  }, [live, prices]);

  const list = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const wanted = rows.filter((n) => {
      const isLive = isLivePhase(phaseOf(n.status, secondsRemaining(n, now)));
      if (view === "live" ? !isLive : isLive) return false;
      if (stockFilter && n.stockMint !== stockFilter) return false;
      if (q && !n.name.toLowerCase().includes(q) && !n.symbol.toLowerCase().includes(q)) return false;
      return true;
    });
    return wanted.sort((a, b) =>
      sort === "fdv" ? fdvOf(b, prices) - fdvOf(a, prices) : Number(b.createdTs - a.createdTs),
    );
  }, [rows, now, view, sort, stockFilter, query, prices]);

  const shown = list.slice(0, limit);
  const left = list.length - shown.length;

  return (
    <Shell>
      <div className="space-y-10">
        {/* Hero: the pitch, and the numbers so far */}
        <section className="grid gap-8 border-b border-neutral-200 pb-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center">
          <div className="max-w-xl">
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-neutral-900 sm:text-5xl">
              Buy the story.
              <br />
              <span className="text-neutral-400">When it expires, you get the stock.</span>
            </h1>
            <Link href="/create" className="mt-7 inline-block">
              <Button variant="accent" size="lg" className="flex items-center gap-2">
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Create a narrative
              </Button>
            </Link>
          </div>

          <div className="rounded border border-neutral-200 bg-neutral-50 p-5">
            <div className="text-sm text-neutral-400">Livestock so far</div>
            <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded border border-neutral-200 bg-neutral-200">
              <Stat label="launched" value={rows ? String(stats.launched) : "—"} />
              <Stat label="combined FDV" value={rows ? compact(stats.fdv) : "—"} />
              <Stat label="locked in vaults" value={rows ? compact(stats.locked) : "—"} />
            </div>
          </div>
        </section>

        {STOCKS.length === 0 ? (
          <Notice kind="error">
            No stock configured. Set <code>NEXT_PUBLIC_STOCKS</code> in <code>app/.env.local</code>.
          </Notice>
        ) : error ? (
          <Notice kind="error">Could not reach the network: {error}</Notice>
        ) : null}

        {/* Three worth a look right now */}
        <div className="scrollbar-hide -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
          <Feature label="Just launched" row={features?.newest ?? null} now={now} prices={prices} kind="new" loading={rows === null} />
          <Feature label="Top FDV" row={features?.top ?? null} now={now} prices={prices} kind="fdv" loading={rows === null} />
          <Feature label="Ending soonest" row={features?.soonest ?? null} now={now} prices={prices} kind="time" loading={rows === null} />
        </div>

        {/* The list */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "live", label: "Live" },
                { value: "ended", label: "Ended" },
              ]}
            />
            <Segmented
              size="sm"
              value={sort}
              onChange={setSort}
              options={[
                { value: "fdv", label: "Top FDV" },
                { value: "new", label: "Newest" },
              ]}
            />
            <StockMenu value={stockFilter} onChange={setStockFilter} />
            <label className="relative ml-auto w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="h-9 w-full rounded border border-neutral-200 bg-neutral-50 pl-9 pr-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                aria-label="Search narratives"
              />
            </label>
          </div>

          {rows === null ? (
            <Skeleton />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Sprout className="h-10 w-10" strokeWidth={1.5} />}
              title={query ? "Nothing matches that" : view === "ended" ? "Nothing has ended yet" : "No live narratives"}
              body={
                view === "live" && !query
                  ? "Launch the first one and set the date it converts."
                  : "Narratives show up here as their dates approach and pass."
              }
              action={
                view === "live" && !query ? (
                  <Link href="/create">
                    <Button variant="accent">Create a narrative</Button>
                  </Link>
                ) : null
              }
            />
          ) : (
            <>
              <div className="sm:hidden">
                <MobileList rows={shown} now={now} prices={prices} view={view} />
              </div>
              <div className="hidden sm:block">
                <Table rows={shown} now={now} prices={prices} view={view} />
              </div>
              {left > 0 ? (
                <div className="flex items-center justify-between">
                  <p className="mono text-xs text-neutral-400">
                    {shown.length} of {list.length}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                    Show {Math.min(PAGE, left)} more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* How it works, for whoever scrolled this far */}
        <section className="border-t border-neutral-200 pt-10">
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900">How it works</h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Step
              title="A story with a date"
              body="A narrative is one thing you think is about to happen, built on top of an existing token, with a date it ends."
            />
            <Step
              title="It trades on a curve"
              body="Every buy pays into a vault in the underlying. Price rises with supply, so early buyers pay less than late ones. Selling early leaves a tax in the vault for whoever stays."
            />
            <Step
              title="On the date it converts"
              body="Trading stops. The vault is split evenly across every token, and each holder claims their share of the underlying. Claims never expire."
            />
            <Step
              title="Nobody judges the story"
              body="Nothing checks whether it came true. You gain if the narrative kept growing after you bought, and you hold the underlying either way."
            />
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-[15px] font-semibold text-neutral-900">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-neutral-400">{body}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-50 px-3 py-3">
      <div className="mono text-xl font-semibold leading-none text-neutral-900 sm:text-2xl">{value}</div>
      <div className="mt-1.5 text-[11px] text-neutral-400">{label}</div>
    </div>
  );
}

function Feature({
  label,
  row: n,
  now,
  prices,
  kind,
  loading,
}: {
  label: string;
  row: NarrativeRow | null;
  now: number;
  prices: Record<string, number>;
  kind: "new" | "fdv" | "time";
  loading: boolean;
}) {
  const frame = "w-[78vw] shrink-0 snap-start rounded border border-neutral-200 bg-neutral-50 p-4 sm:w-auto";
  if (loading) {
    return (
      <div className={frame} aria-hidden>
        <div className="text-xs text-neutral-400">{label}</div>
        <div className="mt-3 h-12 animate-pulse rounded bg-neutral-100" />
      </div>
    );
  }
  if (!n) {
    return (
      <div className={frame}>
        <div className="text-xs text-neutral-400">{label}</div>
        <div className="mt-3 text-sm text-neutral-400">Nothing live yet.</div>
      </div>
    );
  }
  const remaining = secondsRemaining(n, now);
  const phase = phaseOf(n.status, remaining);
  const figure =
    kind === "time"
      ? formatCountdown(remaining)
      : kind === "new"
        ? formatAgo(now - Number(n.createdTs))
        : compact(fdvOf(n, prices));
  const caption =
    kind === "time"
      ? `${compact(fdvOf(n, prices))} FDV`
      : kind === "new"
        ? `${compact(fdvOf(n, prices))} FDV`
        : `${formatUsdAuto(tokenPriceOf(n, prices))} per token`;

  return (
    <Link href={`/n/${n.address}`} className={`${frame} block transition-colors hover:border-neutral-300`}>
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="mt-3 flex items-center gap-3">
        <Thumb src={n.meta?.image} name={n.name} size={40} shape="square" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-neutral-900">{n.name}</div>
          <div className="mono truncate text-xs text-neutral-400">{caption}</div>
        </div>
        <div className="mono shrink-0 text-base font-semibold text-neutral-900">{figure}</div>
      </div>
      <TimeBar createdTs={n.createdTs} expiryTs={n.expiryTs} now={now} phase={phase} className="mt-4" />
    </Link>
  );
}

/** Which stock, as a dropdown. Logos in the menu, one line in the toolbar. */
function StockMenu({ value, onChange }: { value: string | null; onChange: (mint: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const meta = useStockMeta();
  const current = STOCKS.find((s) => s.mint === value) ?? null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-900 hover:bg-neutral-100"
      >
        {current ? <StockLogo stock={current} size={16} /> : <span className="text-neutral-400">Underlying</span>}
        {current ? <span className="mono">{current.symbol}</span> : "All"}
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
      </button>
      {open ? (
        <ul role="listbox" className="absolute left-0 z-20 mt-1 max-h-80 w-56 overflow-auto rounded border border-neutral-200 bg-ground py-1 shadow-xl">
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onMouseDown={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-neutral-900 hover:bg-neutral-50"
            >
              All
              {value === null ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          </li>
          {STOCKS.map((s) => (
            <li key={s.mint}>
              <button
                type="button"
                role="option"
                aria-selected={value === s.mint}
                onMouseDown={() => {
                  onChange(value === s.mint ? null : s.mint);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
              >
                <StockLogo stock={s} size={18} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-neutral-900">{meta[s.mint]?.name ?? s.symbol}</span>
                  <span className="mono ml-1.5 text-xs text-neutral-400">{s.symbol}</span>
                </span>
                {value === s.mint ? <Check className="h-3.5 w-3.5 text-neutral-900" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type ListProps = {
  rows: NarrativeRow[];
  now: number;
  prices: Record<string, number>;
  view: View;
};

/** Phones: one compact row per narrative, no horizontal scrolling. */
function MobileList({ rows, now, prices, view }: ListProps) {
  return (
    <div className="divide-y divide-neutral-200 overflow-hidden rounded border border-neutral-200 bg-neutral-50">
      {rows.map((n) => {
        const remaining = secondsRemaining(n, now);
        const phase = phaseOf(n.status, remaining);
        const backing = backingOf(n, phase);
        const perToken = redemptionPerToken(n);
        return (
          <Link key={n.address} href={`/n/${n.address}`} className="block px-4 py-3.5 active:bg-neutral-100">
            <div className="flex items-center gap-3">
              <Thumb src={n.meta?.image} name={n.name} size={44} shape="square" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-neutral-900">{n.name}</div>
                <div className="mono mt-0.5 text-xs text-neutral-400">
                  {view === "live"
                    ? `${compact(fdvOf(n, prices))} FDV · ${formatCountdown(remaining)}`
                    : phase === "settling"
                      ? "Settling"
                      : `${formatStock(perToken, n.stock.decimals, 4)} ${n.stock.symbol} each`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="mono text-[15px] font-semibold text-neutral-900">
                  {view === "live" ? formatUsdAuto(tokenPriceOf(n, prices)) : formatUsd(usdOf(n, backing, prices), 0)}
                </div>
                {view === "live" ? <Change24h n={n} className="text-xs" /> : null}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Table({ rows, now, prices, view }: ListProps) {
  const router = useRouter();
  const meta = useStockMeta();
  const th = "px-4 py-2.5 text-left text-xs font-medium text-neutral-400";
  return (
    <div className="overflow-hidden rounded border border-neutral-200 bg-neutral-50">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-200">
            <th className={th}>Narrative</th>
            <th className={th}>Converts to</th>
            {view === "live" ? <th className={`${th} text-right`}>Price</th> : null}
            {view === "live" ? <th className={`${th} text-right`}>FDV</th> : null}
            <th className={`${th} text-right md:table-cell`}>Vault</th>
            <th className={`${th} text-right`}>{view === "live" ? "Time left" : "Pays out"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => {
            const remaining = secondsRemaining(n, now);
            const phase = phaseOf(n.status, remaining);
            const backing = backingOf(n, phase);
            const perToken = redemptionPerToken(n);
            const href = `/n/${n.address}`;
            return (
              <tr
                key={n.address}
                onClick={() => router.push(href)}
                className="cursor-pointer border-b border-neutral-200 transition-colors last:border-b-0 hover:bg-neutral-100"
              >
                <td className="px-4 py-3">
                  <Link href={href} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <Thumb src={n.meta?.image} name={n.name} size={36} shape="square" />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold leading-tight text-neutral-900">{n.name}</span>
                      <span className="mono mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
                        {n.symbol}
                        {phase !== "live" ? <StatusDot phase={phase} /> : null}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="mono flex items-center gap-2 text-sm text-neutral-900" title={meta[n.stockMint]?.name}>
                    <StockLogo stock={n.stock} size={20} />
                    {n.stock.symbol}
                  </span>
                </td>
                {view === "live" ? (
                  <td className="mono px-4 py-3 text-right">
                    <div className="text-sm font-semibold text-neutral-900">{formatUsdAuto(tokenPriceOf(n, prices))}</div>
                    <Change24h n={n} className="text-[11px]" />
                  </td>
                ) : null}
                {view === "live" ? (
                  <td className="mono px-4 py-3 text-right">
                    <div className="text-sm font-semibold text-neutral-900">{compact(fdvOf(n, prices))}</div>
                  </td>
                ) : null}
                <td className="mono px-4 py-3 text-right">
                  <div className="text-sm text-neutral-900">{formatUsd(usdOf(n, backing, prices), 0)}</div>
                </td>
                <td className="mono px-4 py-3 text-right">
                  {view === "live" ? (
                    <>
                      <div className="text-sm font-semibold text-neutral-900">{formatCountdown(remaining)}</div>
                      <TimeBar createdTs={n.createdTs} expiryTs={n.expiryTs} now={now} phase={phase} className="ml-auto mt-1.5 w-20" />
                    </>
                  ) : phase === "settling" ? (
                    <div className="text-sm text-neutral-600">Settling</div>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-neutral-900">
                        {formatStock(perToken, n.stock.decimals, 4)} {n.stock.symbol}
                      </div>
                      <div className="text-[11px] text-neutral-400">per token</div>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One row's 24h move; fetched lazily and cached. */
function Change24h({ n, className = "" }: { n: NarrativeRow; className?: string }) {
  const change = usePriceChange(n.address, n);
  return <Delta pct={change?.pct ?? null} approx={change?.inStockTerms} className={className} />;
}

function Skeleton() {
  return (
    <div className="overflow-hidden rounded border border-neutral-200 bg-neutral-50" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0">
          <div className="h-9 w-9 animate-pulse rounded bg-neutral-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-neutral-100" />
            <div className="h-3 w-20 animate-pulse rounded bg-neutral-100" />
          </div>
          <div className="h-4 w-16 animate-pulse rounded bg-neutral-100" />
        </div>
      ))}
    </div>
  );
}
