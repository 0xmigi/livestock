"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sprout } from "lucide-react";
import { formatStock, secondsRemaining } from "@nm/client";

import { Shell } from "@/components/shell";
import { Thumb } from "@/components/thumb";
import {
  Button,
  Chip,
  EmptyState,
  Notice,
  phaseOf,
  Tabs,
  type Phase,
} from "@/components/ui";
import { formatUsd, STOCKS, TAGLINE } from "@/lib/config";
import {
  formatCountdown,
  useNarratives,
  useNow,
  type NarrativeRow,
} from "@/lib/narratives";
import { useStockPrices } from "@/lib/price";

type View = "live" | "soon" | "ended";
type Sort = "vault" | "expiring" | "new";

const SOON = 3 * 24 * 3600;

const SORTS: { value: Sort; label: string }[] = [
  { value: "vault", label: "Biggest vault" },
  { value: "expiring", label: "Ending first" },
  { value: "new", label: "Newest" },
];

function isLivePhase(phase: Phase): boolean {
  return phase === "live" || phase === "closing";
}

export default function Discover() {
  const { rows, error } = useNarratives();
  const now = useNow();
  const prices = useStockPrices();

  const [view, setView] = useState<View>("live");
  const [sort, setSort] = useState<Sort>("vault");
  const [stockFilter, setStockFilter] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { live: 0, soon: 0, ended: 0 };
    for (const n of rows ?? []) {
      const remaining = secondsRemaining(n, now);
      if (isLivePhase(phaseOf(n.status, remaining))) {
        c.live++;
        if (remaining < SOON) c.soon++;
      } else {
        c.ended++;
      }
    }
    return c;
  }, [rows, now]);

  const groups = useMemo(() => {
    if (!rows) return [];

    const wanted = rows.filter((n) => {
      const remaining = secondsRemaining(n, now);
      const live = isLivePhase(phaseOf(n.status, remaining));
      if (view === "ended") {
        if (live) return false;
      } else {
        if (!live) return false;
        if (view === "soon" && remaining >= SOON) return false;
      }
      if (stockFilter && n.stockMint !== stockFilter) return false;
      return true;
    });

    const sorted = [...wanted].sort((a, b) => {
      if (sort === "vault") return Number(b.vaultBalance - a.vaultBalance);
      if (sort === "new") return Number(b.createdTs - a.createdTs);
      return Number(a.expiryTs - b.expiryTs);
    });

    // Group by the stock each narrative expires into, in registry order.
    const byStock = new Map<string, NarrativeRow[]>();
    for (const n of sorted) {
      const list = byStock.get(n.stockMint) ?? [];
      list.push(n);
      byStock.set(n.stockMint, list);
    }
    const order = [
      ...STOCKS.map((s) => s.mint as string),
      ...[...byStock.keys()].filter((m) => !STOCKS.some((s) => s.mint === m)),
    ];
    return order
      .filter((m) => byStock.has(m))
      .map((m) => ({ mint: m, rows: byStock.get(m)! }));
  }, [rows, now, view, sort, stockFilter]);

  const multiStock = STOCKS.length > 1;

  return (
    <Shell>
      <div className="space-y-5">
        <div className="space-y-1 pt-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Markets
          </h1>
          <p className="text-[15px] text-neutral-400">{TAGLINE}</p>
        </div>

        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "live", label: "Live", count: counts.live },
            { value: "soon", label: "Ending soon", count: counts.soon },
            { value: "ended", label: "Ended", count: counts.ended },
          ]}
        />

        <div className="scrollbar-hide -mx-5 flex items-center gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          {SORTS.map((s) => (
            <Chip
              key={s.value}
              active={sort === s.value}
              onClick={() => setSort(s.value)}
            >
              {s.label}
            </Chip>
          ))}
          {multiStock ? (
            <>
              <span className="mx-1 h-5 w-px shrink-0 bg-neutral-200" />
              {STOCKS.map((s) => (
                <Chip
                  key={s.mint}
                  active={stockFilter === s.mint}
                  onClick={() =>
                    setStockFilter(stockFilter === s.mint ? null : s.mint)
                  }
                >
                  {s.symbol}
                </Chip>
              ))}
            </>
          ) : null}
        </div>

        {STOCKS.length === 0 ? (
          <Notice kind="error">
            <strong>No stock configured.</strong> Set{" "}
            <code>NEXT_PUBLIC_STOCKS</code> or <code>NEXT_PUBLIC_STOCK_MINT</code>{" "}
            in <code>app/.env.local</code>.
          </Notice>
        ) : error ? (
          <Notice kind="error">Could not reach the network: {error}</Notice>
        ) : rows === null ? (
          <Skeleton />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Sprout className="h-10 w-10" strokeWidth={1.5} />}
            title={
              view === "ended"
                ? "Nothing has ended yet"
                : view === "soon"
                  ? "Nothing ends in the next three days"
                  : "No live narratives"
            }
            body={
              view === "live"
                ? "A narrative is one thing you think a company is about to do. Launch the first one and set the date it turns into stock."
                : "Narratives show up here as their dates approach and pass."
            }
            action={
              view === "live" ? (
                <Link href="/create">
                  <Button variant="outline">Create a narrative</Button>
                </Link>
              ) : null
            }
          />
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <StockGroup
                key={g.mint}
                rows={g.rows}
                now={now}
                priceUsd={prices[g.mint]}
                heading={multiStock || !g.rows[0].stock.known}
              />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

function StockGroup({
  rows,
  now,
  priceUsd,
  heading,
}: {
  rows: NarrativeRow[];
  now: number;
  priceUsd: number | undefined;
  heading: boolean;
}) {
  const stock = rows[0].stock;
  const price = priceUsd ?? stock.fallbackPriceUsd;

  return (
    <section>
      {heading ? (
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">
            {stock.symbol}
          </h2>
          {price > 0 ? (
            <span className="numeric text-xs text-neutral-400">
              {formatUsd(price)}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="-mx-2">
        {rows.map((n) => (
          <Row key={n.address} narrative={n} now={now} priceUsd={price} />
        ))}
      </div>
    </section>
  );
}

function Row({
  narrative: n,
  now,
  priceUsd,
}: {
  narrative: NarrativeRow;
  now: number;
  priceUsd: number;
}) {
  const remaining = secondsRemaining(n, now);
  const phase = phaseOf(n.status, remaining);
  const live = isLivePhase(phase);
  const backing = live || phase === "settling" ? n.vaultBalance : n.finalVault;
  const backingUsd = (Number(backing) / 10 ** n.stock.decimals) * priceUsd;

  const dot =
    phase === "live"
      ? "bg-live"
      : phase === "settled"
        ? "bg-settled"
        : "bg-closing";
  const caption = live
    ? `${formatCountdown(remaining)} left`
    : phase === "settling"
      ? "Awaiting settlement"
      : phase === "redeemable"
        ? "Redeemable"
        : "Settled";

  return (
    <Link
      href={`/n/${n.address}`}
      className="flex items-center gap-4 rounded-2xl px-2 py-3 transition-colors hover:bg-neutral-50 active:bg-neutral-100"
    >
      <Thumb
        src={n.meta?.image}
        name={n.name}
        size={52}
        className=""
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold text-neutral-900">
          {n.name}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-neutral-400">
          <span className="numeric">${n.symbol}</span>
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          <span className="numeric truncate">{caption}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="numeric text-[17px] font-semibold text-neutral-900">
          {priceUsd > 0
            ? formatUsd(backingUsd)
            : formatStock(backing, n.stock.decimals, 2)}
        </div>
        <div className="numeric mt-0.5 text-sm text-neutral-400">
          {formatStock(backing, n.stock.decimals, 2)} {n.stock.symbol}
        </div>
      </div>
    </Link>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <div className="h-[52px] w-[52px] animate-pulse rounded-full bg-neutral-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-neutral-100" />
            <div className="h-3 w-24 animate-pulse rounded bg-neutral-50" />
          </div>
        </div>
      ))}
    </div>
  );
}
