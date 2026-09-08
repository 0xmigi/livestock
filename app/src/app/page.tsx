"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, Sprout } from "lucide-react";
import { formatStock, redemptionPerToken, secondsRemaining } from "@nm/client";

import { Explainer } from "@/components/explainer";
import { Ticker } from "@/components/ticker";
import { Highlight } from "@/components/highlight";
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
} from "@/components/ui";
import { formatUsd, formatUsdAuto, type StockInfo } from "@/lib/config";
import { backingOf, compact, fdvOf, isLivePhase, tokenPriceOf, usdOf } from "@/lib/figures";
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
import { useStocks } from "@/lib/stocks";

type View = "live" | "ended";

const PAGE = 10;

export default function Markets() {
  const { rows, error } = useNarratives();
  const now = useNow();
  const prices = useStockPrices();
  const { stocks, loaded: stocksLoaded, error: stocksError } = useStocks();

  const [view, setView] = useState<View>("live");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // A new filter starts the list from the top again.
  useEffect(() => setLimit(PAGE), [view, query]);

  // The search covers the underlying too, so "tesla" finds every TSLAx narrative.
  const stockNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const s of stocks) out.set(s.mint, `${s.symbol} ${s.ticker} ${s.name}`.toLowerCase());
    return out;
  }, [stocks]);

  const live = useMemo(
    () => (rows ?? []).filter((n) => isLivePhase(phaseOf(n.status, secondsRemaining(n, now)))),
    [rows, now],
  );

  const list = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const wanted = rows.filter((n) => {
      const isLive = isLivePhase(phaseOf(n.status, secondsRemaining(n, now)));
      if (view === "live" ? !isLive : isLive) return false;
      if (
        q &&
        !n.name.toLowerCase().includes(q) &&
        !n.symbol.toLowerCase().includes(q) &&
        !(stockNames.get(n.stockMint) ?? "").includes(q)
      ) {
        return false;
      }
      return true;
    });
    return wanted.sort((a, b) => fdvOf(b, prices) - fdvOf(a, prices));
  }, [rows, now, view, query, prices, stockNames]);

  const shown = list.slice(0, limit);
  const left = list.length - shown.length;

  return (
    <Shell>
      <div className="space-y-10">
        {/* Hero: the pitch, and the numbers so far */}
        <section className="grid pb-6 lg:grid-cols-3 lg:gap-x-3">
          {/* Headline on its own row; the button and the chart share the next, so the chart hangs from the button's line. */}
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight text-neutral-900 sm:text-5xl lg:col-span-3 lg:row-start-1">
            Buy live narratives.
            <br />
            <span className="text-neutral-400">Expire into real stocks.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-neutral-400 lg:col-span-3 lg:row-start-2">
            A token for a story about a stock. Every buy fills a vault of that stock, and on the date every token
            becomes it.
          </p>
          <div className="mt-7 lg:col-start-1 lg:row-start-3 lg:self-start">
            <Link href="/create" className="inline-block">
              <Button variant="primary" size="lg" className="flex items-center gap-2">
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Create a narrative
              </Button>
            </Link>
          </div>

          {/* Proof over pitch: the week's best trade once there is one, the explainer until then. */}
          {/* Two thirds wide: the width of two of the three cards below, so the edges line up. */}
          <div className="mt-7 min-w-0 overflow-hidden lg:col-span-2 lg:col-start-2 lg:row-start-3 lg:self-start">
            <Highlight fallback={<Explainer />} />
          </div>
        </section>

        {stocksLoaded && stocks.length === 0 ? (
          <Notice kind="error">{stocksError ?? "No stocks are listed right now."}</Notice>
        ) : error ? (
          <Notice kind="error">Could not reach the network: {error}</Notice>
        ) : null}

        {/* Tokenized stock prices, live, drifting by between the pitch and the market. Real data whatever is launched. */}
        <Ticker />

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
            <label className="relative ml-auto w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search narratives or stocks"
                className="h-8 w-full rounded border border-neutral-200 bg-neutral-50 pl-9 pr-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                aria-label="Search narratives"
              />
            </label>
          </div>

          {rows === null ? (
            <Skeleton />
          ) : list.length === 0 && view === "live" && !query ? (
            <Launchpad stocks={stocks} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Sprout className="h-10 w-10" strokeWidth={1.5} />}
              title={query ? "Nothing matches that" : view === "ended" ? "Nothing has ended yet" : "No live narratives"}
              body="Narratives show up here as their dates approach and pass."
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


      </div>
    </Shell>
  );
}

/** How many stocks the empty market shows as launch candidates. */
const LAUNCHPAD_STOCKS = 8;

/**
 * The market with nothing in it: one honest line, then the tokenized stocks
 * with the deepest markets, each a click from launching on it. Real prices,
 * not fake launches.
 */
function Launchpad({ stocks }: { stocks: StockInfo[] }) {
  return (
    <StockGrid
      stocks={stocks}
      lead={
        <span className="text-sm text-neutral-900">
          Nothing live yet.{" "}
          <span className="text-neutral-400">Pick a stock to launch the first narrative on it.</span>
        </span>
      }
    />
  );
}

/** The deepest tokenized stocks, each a click from launching on it. */
function StockGrid({ stocks, lead }: { stocks: StockInfo[]; lead?: React.ReactNode }) {
  const candidates = stocks.filter((s) => s.available).slice(0, LAUNCHPAD_STOCKS);
  if (candidates.length === 0) return null;
  return (
    <div className="rounded bg-neutral-50 p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pb-3 pt-2">
        {lead ?? (
          <span className="mono text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
            Stocks to build on
          </span>
        )}
        <Link href="/how-it-works" className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-900">
          How it works
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {candidates.map((s) => (
          <LaunchStock key={s.mint} stock={s} />
        ))}
      </div>
    </div>
  );
}

function LaunchStock({ stock }: { stock: StockInfo }) {
  const price = stock.priceUsd ?? stock.fallbackPriceUsd;
  const change = stock.change24hPercent;
  return (
    <Link
      href={`/create?stock=${encodeURIComponent(stock.symbol)}`}
      className="lift flex items-center gap-3 rounded bg-neutral-100 p-3"
    >
      <StockLogo stock={stock} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-neutral-900">{stock.name}</span>
        <span className="mono block truncate text-xs text-neutral-400">{stock.symbol}</span>
      </span>
      <span className="mono shrink-0 text-right text-xs">
        <span className="block text-neutral-900">{price > 0 ? formatUsd(price) : "—"}</span>
        {change !== undefined ? (
          <span className={`block ${change >= 0 ? "text-success" : "text-danger"}`}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>
        ) : null}
      </span>
    </Link>
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
    <div className="divide-y divide-neutral-100 overflow-hidden rounded bg-neutral-50">
      {rows.map((n) => {
        const remaining = secondsRemaining(n, now);
        const phase = phaseOf(n.status, remaining);
        const backing = backingOf(n, phase);
        const perToken = redemptionPerToken(n);
        return (
          <Link key={n.address} href={`/n/${n.address}`} className="block px-4 py-3.5 transition-colors active:bg-press">
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
    <div className="overflow-hidden rounded bg-neutral-50">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-100">
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
                className="cursor-pointer border-b border-neutral-100 transition-colors last:border-b-0 hover:bg-hover active:bg-press"
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
    <div className="overflow-hidden rounded bg-neutral-50" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0">
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
