"use client";

import { use } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { ChevronLeft, ExternalLink } from "lucide-react";
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
  Card,
  Hero,
  Notice,
  Overview,
  phaseOf,
  StatusDot,
  StockLogo,
  Tile,
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
import { useStockPrice } from "@/lib/price";

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

  // What one token is worth right now: the vault split across supply. After
  // expiry this is the frozen redemption figure.
  const perTokenNow =
    narrative.status === Status.Live ? (supply > 0n ? backing / supply : 0n) : perToken;
  const share = (tokens: bigint) =>
    supply > 0n ? (Number(tokens) / Number(supply)) * 100 : 0;
  const pct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;
  const usdSuffix = priceIsLive ? "" : " est.";
  const inStock = (usd: string) => (price > 0 ? `${stock.symbol} ≈ ${usd}` : stock.symbol);

  return (
    <Shell>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <div className="min-w-0 space-y-8">
        <Link
          href="/"
          className="mono inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-900"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Markets
        </Link>

        {/* Identity */}
        <header className="flex items-start gap-4">
          <Thumb src={narrative.meta?.image} name={narrative.name} size={64} shape="square" />
          <div className="min-w-0 flex-1">
            <h1 className="display text-2xl text-neutral-900 sm:text-3xl">
              {narrative.name}
            </h1>
            <div className="mono mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-neutral-400">
              <span>${narrative.symbol}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5">
                <StockLogo stock={stock} size={14} />
                converts to {stock.symbol}
              </span>
              <span aria-hidden>·</span>
              <StatusDot phase={phase} pulse />
            </div>
          </div>
        </header>

        {/* The one hero number, and the bar that is the product */}
        <div className="space-y-4 rounded border border-neutral-200 bg-neutral-50 p-5 sm:p-6">
          {tradable ? (
            <Hero
              align="left"
              label="Time remaining"
              value={formatCountdown(remaining)}
              sub={`Converts to ${stock.symbol} on ${formatDate(narrative.expiryTs)}`}
            />
          ) : phase === "settling" ? (
            <Hero
              align="left"
              label="Trading closed"
              value="Settling"
              sub={`Expired ${formatDate(narrative.expiryTs)}. Claims open once settled.`}
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
            <Hero
              align="left"
              label="Fully settled"
              value="Done"
              muted
              sub={`Every token was converted into ${stock.symbol}`}
            />
          )}
          <TimeBar createdTs={narrative.createdTs} expiryTs={narrative.expiryTs} now={now} phase={phase} />
          <div className="mono flex justify-between text-[11px] text-neutral-400">
            <span>Launched {formatDate(narrative.createdTs)}</span>
            <span>Expires {formatDate(narrative.expiryTs)}</span>
          </div>
        </div>

        {/* The numbers */}
        <Overview
          title="Overview"
          aside={price > 0 ? `${stock.symbol} ${formatUsd(price)}${usdSuffix}` : stock.symbol}
          footer={
            <>
              Created by{" "}
              <FootLink href={explorerUrl(narrative.creator)}>{shortAddress(narrative.creator)}</FootLink>
              . Token{" "}
              <FootLink href={explorerUrl(narrative.narrativeMint)}>{shortAddress(narrative.narrativeMint)}</FootLink>
              . The expiry date was fixed at creation and cannot move.
            </>
          }
        >
          <Tile label="Vault" value={formatStock(backing, stock.decimals, 2)} sub={inStock(formatUsd(toUsd(backing)))} />
          <Tile label="Supply" value={supply.toLocaleString()} sub={`$${narrative.symbol}`} />
          {tradable ? (
            <Tile label="Next token" value={formatStock(nextPrice, stock.decimals, 6)} sub={inStock(formatUsdAuto(toUsd(nextPrice)))} />
          ) : (
            <Tile
              label="Status"
              value={phase === "settling" ? "Settling" : phase === "redeemable" ? "Redeemable" : "Settled"}
              sub={`Expired ${formatDate(narrative.expiryTs)}`}
            />
          )}
          <Tile label={tradable ? "Per token now" : "Per token"} value={formatStock(perTokenNow, stock.decimals, 6)} sub={inStock(formatUsdAuto(toUsd(perTokenNow)))} />
          <Tile
            label="Expires"
            value={formatDate(narrative.expiryTs).split(",")[0]}
            sub={tradable ? `${formatCountdown(remaining)} left` : formatDate(narrative.expiryTs).split(",")[1]?.trim()}
          />
          <Tile label="Creator fee" value={`${(narrative.feeBps / 100).toFixed(2)}%`} sub="on every buy" />
          <Tile label="Exit tax" value={`${(narrative.sellTaxBps / 100).toFixed(0)}%`} sub="kept in the vault" />
          <Tile
            label="Creator holds"
            value={creatorHoldings !== null ? creatorHoldings.toLocaleString() : "—"}
            sub={creatorHoldings !== null && supply > 0n ? `${pct(share(creatorHoldings))} of supply` : `$${narrative.symbol}`}
          />
        </Overview>

        {/* About */}
        {narrative.meta?.description || narrative.meta?.website || narrative.meta?.twitter || narrative.meta?.telegram ? (
          <Card className="space-y-4">
            {narrative.meta.description ? (
              <p className="text-sm leading-relaxed text-neutral-600">{narrative.meta.description}</p>
            ) : null}
            {narrative.meta.website || narrative.meta.twitter || narrative.meta.telegram ? (
              <div className="flex flex-wrap gap-2">
                {narrative.meta.website ? <LinkChip href={narrative.meta.website}>Website</LinkChip> : null}
                {narrative.meta.twitter ? <LinkChip href={narrative.meta.twitter}>X</LinkChip> : null}
                {narrative.meta.telegram ? <LinkChip href={narrative.meta.telegram}>Telegram</LinkChip> : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        <p className="px-1 text-sm leading-relaxed text-neutral-400">
          Your payout is the vault split evenly across every token. You gain if the narrative kept
          growing after you bought, and you receive {stock.symbol} either way. Nothing here checks
          whether the story came true: payoff follows flows, not facts.
        </p>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-6">
        {/* Action */}
        <Card className="!p-5">
          {!ready ? (
            <div className="h-24 animate-pulse rounded bg-neutral-100" />
          ) : !authenticated || !owner ? (
            <div className="py-4 text-center">
              <p className="text-sm text-neutral-600">
                {tradable ? `Log in to buy $${narrative.symbol}.` : "Log in to see your position."}
              </p>
              <Button onClick={login} className="mt-4 w-full" size="lg">
                Log in or sign up
              </Button>
            </div>
          ) : narrative.status === Status.Settled ? (
            <Notice>
              This narrative is fully settled. Every claim has been converted into {stock.symbol}.
            </Notice>
          ) : narrative.status === Status.Expired ? (
            <RedeemPanel narrative={narrative} position={position} owner={owner} stockPrice={price} onDone={refresh} />
          ) : phase === "settling" ? (
            <div className="space-y-4">
              <Notice>
                The date has passed and trading has stopped. Someone needs to settle it before claims
                open. Anyone can, including you.
              </Notice>
              <ExpireButton narrative={narrative} owner={owner} onDone={refresh} />
            </div>
          ) : (
            <BuyPanel narrative={narrative} position={position} owner={owner} stockPrice={price} onDone={refresh} />
          )}
        </Card>

        {/* Position */}
        {owner && held > 0n && narrative.status !== Status.Expired ? (
          <Overview title="Your position" columns={2}>
            <Tile label="You hold" value={held.toLocaleString()} sub={`$${narrative.symbol}`} />
            <Tile label="Share of supply" value={pct(share(held))} sub={`of ${supply.toLocaleString()}`} />
            <Tile
              label="Worth at expiry"
              value={formatStock(supply > 0n ? (backing * held) / supply : 0n, stock.decimals, 4)}
              sub={inStock(formatUsdAuto(toUsd(supply > 0n ? (backing * held) / supply : 0n)))}
            />
            <Tile
              label="In your wallet"
              value={formatStock(position?.stockBalance ?? 0n, stock.decimals, 2)}
              sub={inStock(formatUsd(toUsd(position?.stockBalance ?? 0n)))}
            />
          </Overview>
        ) : null}

      </aside>
      </div>
    </Shell>
  );
}

function FootLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mono inline-flex items-center gap-0.5 text-neutral-600 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function LinkChip({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mono inline-flex items-center gap-1 rounded bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
