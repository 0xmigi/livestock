"use client";

import { use } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { ChevronLeft, Clock, ExternalLink, Link2 } from "lucide-react";
import {
  formatStock,
  redemptionPerToken,
  secondsRemaining,
  spotPrice,
  Status,
} from "@nm/client";
import { address } from "@solana/kit";

import { BuyPanel, RedeemPanel } from "@/components/actions";
import { ExpireButton } from "@/components/expire";
import { Shell } from "@/components/shell";
import { Thumb } from "@/components/thumb";
import {
  Button,
  Delta,
  Hero,
  Notice,
  phaseOf,
  StatusDot,
  StockLogo,
  TimeBar,
} from "@/components/ui";
import { useOwner } from "@/components/wallet";
import {
  explorerUrl,
  formatUsd,
  formatUsdAuto,
  shortAddress,
} from "@/lib/config";
import {
  formatCountdown,
  formatDate,
  useNarrative,
  useNow,
} from "@/lib/narratives";
import { useActivity, usePriceChange } from "@/lib/change";
import { useHolders } from "@/lib/holders";
import { EditNarrative } from "@/components/edit-narrative";
import { useStockPrice } from "@/lib/price";

/** The clock: blue, mono, `13d 15h 1m 22s`, ticking every second. */
function Countdown({ seconds }: { seconds: number }) {
  const t = Math.max(0, seconds);
  const d = Math.floor(t / 86_400);
  const h = Math.floor((t % 86_400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const text = d > 0 ? `${d}d ${h}h ${m}m ${sec}s` : h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  return (
    <span className="mono inline-flex items-center gap-1.5 text-base font-medium text-accent" aria-label="Time remaining">
      <Clock className="h-3.5 w-3.5" strokeWidth={2} />
      {text}
    </span>
  );
}

export default function NarrativePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = use(params);
  const { authenticated, login, ready } = usePrivy();
  const owner = useOwner();
  const now = useNow();

  let parsed = null;
  try {
    parsed = address(raw);
  } catch {
    // handled below
  }

  const { narrative, position, creatorHoldings, error, loading, refresh } =
    useNarrative(parsed, owner);
  const { price, isLive: priceIsLive } = useStockPrice(narrative?.stockMint);
  const change = usePriceChange(parsed, narrative);
  const activity = useActivity(parsed, narrative);
  const holders = useHolders(narrative?.narrativeMint ?? null, narrative?.supply ?? null);

  if (!parsed) {
    return (
      <Shell>
        <Notice kind="error">That is not a valid address.</Notice>
      </Shell>
    );
  }

  if (loading && !narrative) {
    return (
      <Shell>
        <div className="space-y-4" aria-hidden>
          <div className="h-16 w-16 animate-pulse rounded bg-neutral-100" />
          <div className="h-10 w-72 animate-pulse rounded bg-neutral-100" />
          <div className="h-1 w-full animate-pulse rounded bg-neutral-100" />
          <div className="h-40 w-full animate-pulse rounded bg-neutral-50" />
        </div>
      </Shell>
    );
  }

  if (!narrative) {
    return (
      <Shell>
        <Notice kind="error">{error ?? "Narrative not found."}</Notice>
      </Shell>
    );
  }

  const stock = narrative.stock;
  const remaining = secondsRemaining(narrative, now);
  const phase = phaseOf(narrative.status, remaining);
  const tradable = phase === "live" || phase === "closing";
  const perToken = redemptionPerToken(narrative);

  // Before expiry the vault is live; after, the frozen snapshot is what pays.
  const backing =
    narrative.status === Status.Live ? narrative.vaultBalance : narrative.finalVault;
  const supply =
    narrative.status === Status.Live ? narrative.supply : narrative.finalSupply;
  const toUsd = (units: bigint) => (Number(units) / 10 ** stock.decimals) * price;

  const nextPrice = spotPrice(narrative.supply, narrative);
  const held = position?.tokens ?? 0n;
  // Narratives minted with the program as permanent delegate are paid out by
  // the keeper; older ones need each holder to claim.
  const autoConverts = narrative.meta?.permanentDelegate === narrative.address;
  const sourceHref = narrative.meta?.twitter ?? narrative.meta?.website ?? narrative.meta?.telegram ?? null;

  // What one token is worth right now: the vault split across supply. After
  // expiry this is the frozen redemption figure.
  const perTokenNow =
    narrative.status === Status.Live ? (supply > 0n ? backing / supply : 0n) : perToken;
  const share = (tokens: bigint) =>
    supply > 0n ? (Number(tokens) / Number(supply)) * 100 : 0;
  const pct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;
  const usdSuffix = priceIsLive ? "" : " est.";
  const inStock = (usd: string) => (price > 0 ? `${stock.symbol} ≈ ${usd}` : stock.symbol);

  const action = !ready ? (
    <div className="h-24 animate-pulse rounded bg-neutral-100" />
  ) : !authenticated || !owner ? (
    <div className="flex h-full flex-col justify-center py-2 text-center">
      <p className="text-sm text-neutral-600">
        {tradable ? `Log in to buy $${narrative.symbol}.` : "Log in to see your position."}
      </p>
      <Button onClick={login} className="mt-4 w-full" size="lg">
        Log in or sign up
      </Button>
    </div>
  ) : narrative.status === Status.Settled ? (
    <Notice>This narrative is fully settled. Every token has been converted into {stock.symbol}.</Notice>
  ) : narrative.status === Status.Expired && autoConverts ? (
    <div className="space-y-4">
      <Notice>
        {held > 0n
          ? `Your ${held.toLocaleString()} $${narrative.symbol} are being converted into ${stock.symbol}. It lands in your wallet within a few minutes.`
          : `Holders are being paid out in ${stock.symbol}.`}
      </Notice>
      {held > 0n ? (
        <RedeemPanel narrative={narrative} position={position} owner={owner} stockPrice={price} onDone={refresh} compact />
      ) : null}
    </div>
  ) : narrative.status === Status.Expired ? (
    <RedeemPanel narrative={narrative} position={position} owner={owner} stockPrice={price} onDone={refresh} />
  ) : phase === "settling" ? (
    <div className="space-y-4">
      <Notice>
        {autoConverts
          ? `The date has passed and trading has stopped. Every holder is being paid out in ${stock.symbol}; this takes a few minutes.`
          : "The date has passed and trading has stopped. Someone needs to settle it before claims open. Anyone can, including you."}
      </Notice>
      <ExpireButton narrative={narrative} owner={owner} onDone={refresh} quiet={autoConverts} />
    </div>
  ) : (
    <BuyPanel narrative={narrative} position={position} owner={owner} stockPrice={price} onDone={refresh} />
  );

  return (
    <Shell>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="mono inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-900"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Markets
          </Link>
          {owner ? <EditNarrative narrative={narrative} owner={owner} onDone={refresh} /> : null}
        </div>

        {/* The clock and the action, in one panel */}
        <section className="grid overflow-hidden rounded border border-neutral-200 bg-neutral-50 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex flex-col justify-between gap-6 p-5 sm:p-6">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Thumb src={narrative.meta?.image} name={narrative.name} size={48} shape="square" />
                  <div className="min-w-0">
                    <h1 className="line-clamp-2 text-xl font-semibold leading-tight text-neutral-900">{narrative.name}</h1>
                    <div className="mono mt-1 flex items-center gap-2 text-xs text-neutral-400">
                      ${narrative.symbol}
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <StockLogo stock={stock} size={12} />
                        {stock.symbol}
                      </span>
                      {phase !== "live" ? <StatusDot phase={phase} /> : null}
                    </div>
                  </div>
                </div>
                {tradable ? (
                  <div className="shrink-0 text-right">
                    <div className="numeric text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
                      {formatUsdAuto(toUsd(nextPrice))}
                    </div>
                    <Delta pct={change?.pct ?? null} approx={change?.inStockTerms} className="text-sm font-medium" />
                  </div>
                ) : null}
              </div>
              {/* The bio, as on a profile: a few lines and one link. */}
              {narrative.meta?.description || sourceHref ? (
                <div className="max-w-prose space-y-1.5">
                  {narrative.meta?.description ? (
                    <p className="text-[13px] leading-snug text-neutral-600">{narrative.meta.description}</p>
                  ) : null}
                  {sourceHref ? (
                    <a
                      href={sourceHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-neutral-900"
                    >
                      <Link2 className="h-3 w-3 shrink-0" />
                      {sourceLabel(sourceHref)}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            {tradable ? null : phase === "settling" ? (
              <Hero
                align="left"
                label="Trading closed"
                value="Settling"
                sub="Claims open once settled."
              />
            ) : phase === "redeemable" ? (
              <Hero
                align="left"
                label="Each token converts to"
                value={
                  <>
                    {formatStock(perToken, stock.decimals, 6)}
                    <span className="ml-2 text-2xl font-semibold text-neutral-400">{stock.symbol}</span>
                  </>
                }
                sub={`≈ ${formatUsdAuto(toUsd(perToken))}. Claims never expire.`}
              />
            ) : (
              <Hero align="left" label="Fully settled" value="Done" muted sub={`Every token was converted into ${stock.symbol}`} />
            )}
            <div>
              {tradable ? (
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span className="text-xs text-neutral-400">Time remaining</span>
                  <Countdown seconds={remaining} />
                </div>
              ) : null}
              <TimeBar createdTs={narrative.createdTs} expiryTs={narrative.expiryTs} now={now} phase={phase} />
            </div>
          </div>
          <div className="border-t border-neutral-200 p-5 lg:border-l lg:border-t-0">{action}</div>
        </section>

        {/* Details, in the order a buyer asks: is it alive, what do I get, how big, who is behind it */}
        <section className="flex flex-col gap-px overflow-hidden rounded border border-neutral-200 bg-neutral-200">
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <Figure
              label="24h volume"
              value={activity ? formatUsd(toUsd(activity.volume), 0) : "—"}
              sub={activity ? `${activity.buys} buys · ${activity.sells} sells` : undefined}
            />
            <Figure
              label="Holders"
              value={holders ? `${holders.count}${holders.more ? "+" : ""}` : "—"}
              sub={
                holders && holders.count > 0 && supply > 0n
                  ? `top holds ${pct((Number(holders.top) / Number(supply)) * 100)}${holders.topOwner === narrative.creator ? ", the creator" : ""}`
                  : undefined
              }
            />
            <Figure
              label="Pays per token"
              value={`${formatStock(perTokenNow, stock.decimals, 6)} ${stock.symbol}`}
              sub={price > 0 ? `≈ ${formatUsdAuto(toUsd(perTokenNow))}` : undefined}
            />
            <Figure
              label="Vault"
              value={`${formatStock(backing, stock.decimals, 2)} ${stock.symbol}`}
              sub={price > 0 ? `≈ ${formatUsd(toUsd(backing))}` : undefined}
            />
          </div>
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <Small label="FDV" value={formatUsd(toUsd(nextPrice * supply), 0)} />
            <Small label="Supply" value={`${supply.toLocaleString()} ${narrative.symbol}`} />
            <Small
              label="Creator holds"
              value={creatorHoldings !== null && supply > 0n ? pct(share(creatorHoldings)) : "—"}
            />
            <Small label="Launched" value={formatDate(narrative.createdTs)} />
          </div>
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <Small label="Token" value={<FootLink href={explorerUrl(narrative.narrativeMint)}>{shortAddress(narrative.narrativeMint)}</FootLink>} />
            <Small label="Creator" value={<FootLink href={explorerUrl(narrative.creator)}>{shortAddress(narrative.creator)}</FootLink>} />
            <Small
              label="Source"
              value={
                narrative.meta?.twitter ? (
                  <FootLink href={narrative.meta.twitter}>X</FootLink>
                ) : narrative.meta?.website ? (
                  <FootLink href={narrative.meta.website}>Website</FootLink>
                ) : narrative.meta?.telegram ? (
                  <FootLink href={narrative.meta.telegram}>Telegram</FootLink>
                ) : (
                  <span className="text-neutral-400">none</span>
                )
              }
            />
            <Small label="Converts to" value={<span className="inline-flex items-center gap-1.5"><StockLogo stock={stock} size={14} />{stock.symbol}</span>} />
          </div>
        </section>

      </div>
    </Shell>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 bg-neutral-50 px-4 py-3">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="mono mt-1 truncate text-[15px] font-semibold text-neutral-900">{value}</div>
      {sub ? <div className="mono mt-0.5 truncate text-[11px] text-neutral-400">{sub}</div> : null}
    </div>
  );
}

function Small({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-neutral-50 px-4 py-2.5">
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className="mono mt-0.5 truncate text-[13px] text-neutral-900">{value}</div>
    </div>
  );
}

/** A short name for where a link goes: "X", "Telegram", or the site's host. */
function sourceLabel(href: string): string {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "x.com" || host === "twitter.com") return "X";
    if (host === "t.me" || host === "telegram.me") return "Telegram";
    return host;
  } catch {
    return "Link";
  }
}

function FootLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mono inline-flex items-center gap-0.5 text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
