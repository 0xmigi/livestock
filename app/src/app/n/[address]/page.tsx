"use client";

import { use } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ExternalLink } from "lucide-react";
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
import {
  Button,
  Card,
  Hero,
  Notice,
  phaseOf,
  Stat,
  StatusDot,
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
import { Thumb } from "@/components/thumb";

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
      <Shell width="narrow">
        <Notice kind="error">That is not a valid address.</Notice>
      </Shell>
    );
  }

  if (loading && !narrative) {
    return (
      <Shell width="narrow">
        <div className="space-y-4" aria-hidden>
          <div className="mx-auto h-16 w-16 animate-pulse rounded-2xl bg-neutral-100" />
          <div className="mx-auto h-8 w-48 animate-pulse rounded-lg bg-neutral-100" />
          <div className="mx-auto h-14 w-40 animate-pulse rounded-lg bg-neutral-50" />
        </div>
      </Shell>
    );
  }

  if (!narrative) {
    return (
      <Shell width="narrow">
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
    narrative.status === Status.Live
      ? narrative.vaultBalance
      : narrative.finalVault;
  const supply =
    narrative.status === Status.Live
      ? narrative.supply
      : narrative.finalSupply;
  const toUsd = (units: bigint) =>
    (Number(units) / 10 ** stock.decimals) * price;

  const nextPrice = spotPrice(narrative.supply, narrative);
  const held = position?.tokens ?? 0n;

  return (
    <Shell width="narrow">
      <div className="space-y-8">
        {/* Identity */}
        <div className="flex flex-col items-center pt-2 text-center">
          <Thumb
            src={narrative.meta?.image}
            name={narrative.name}
            size={72}
            className=""
          />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
            {narrative.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-neutral-400">
            <span className="numeric">${narrative.symbol}</span>
            <span aria-hidden>·</span>
            <span>expires into {stock.symbol}</span>
            <span aria-hidden>·</span>
            <StatusDot phase={phase} pulse />
          </div>
        </div>

        {/* The one hero number */}
        <div className="py-2 sm:py-4">
          {tradable ? (
            <Hero
              label="Time remaining"
              value={formatCountdown(remaining)}
              sub={`Converts to ${stock.symbol} on ${formatDate(narrative.expiryTs)}`}
            />
          ) : phase === "settling" ? (
            <Hero
              label="Trading closed"
              value="Settling"
              sub={`Expired ${formatDate(narrative.expiryTs)} · claims open once settled`}
            />
          ) : phase === "redeemable" ? (
            <Hero
              label="Each token converts to"
              value={
                <>
                  {formatStock(perToken, stock.decimals, 6)}
                  <span className="ml-2 text-2xl font-semibold text-neutral-400">
                    {stock.symbol}
                  </span>
                </>
              }
              sub={`≈ ${formatUsdAuto(toUsd(perToken))} · claims never expire`}
            />
          ) : (
            <Hero
              label="Fully settled"
              value="Done"
              muted
              sub={`Every token was converted into ${stock.symbol}`}
            />
          )}
        </div>

        {/* The two numbers that are the product */}
        <Card className="!p-5">
          <div className="grid grid-cols-2 gap-6">
            <Stat
              label="Vault"
              value={
                <>
                  {formatStock(backing, stock.decimals, 2)}
                  <span className="ml-1.5 text-sm font-normal text-neutral-400">
                    {stock.symbol}
                  </span>
                </>
              }
              sub={
                price > 0
                  ? `≈ ${formatUsd(toUsd(backing))}${priceIsLive ? "" : " (est.)"}`
                  : undefined
              }
            />
            <Stat
              label="Supply"
              value={supply.toLocaleString()}
              sub={
                tradable
                  ? `next token ${formatStock(nextPrice, stock.decimals, 6)} · ≈ ${formatUsdAuto(toUsd(nextPrice))}`
                  : perToken > 0n
                    ? `${formatStock(perToken, stock.decimals, 6)} each`
                    : undefined
              }
            />
          </div>
        </Card>

        {/* Action */}
        <Card className="!p-5">
          {!ready ? (
            <div className="h-24 animate-pulse rounded-lg bg-neutral-50" />
          ) : !authenticated || !owner ? (
            <div className="py-4 text-center">
              <p className="text-sm text-neutral-600">
                {tradable
                  ? `Log in to buy $${narrative.symbol}.`
                  : "Log in to see your position."}
              </p>
              <Button
                onClick={login}
                className="mt-4 w-full !py-3.5 !text-base"
                size="lg"
              >
                Log in or sign up
              </Button>
            </div>
          ) : narrative.status === Status.Settled ? (
            <Notice>
              This narrative is fully settled. Every claim has been converted
              into {stock.symbol}.
            </Notice>
          ) : narrative.status === Status.Expired ? (
            <RedeemPanel
              narrative={narrative}
              position={position}
              owner={owner}
              stockPrice={price}
              onDone={refresh}
            />
          ) : phase === "settling" ? (
            <div className="space-y-4">
              <Notice>
                The date has passed and trading has stopped. Someone needs to
                settle it before claims open. Anyone can, including you.
              </Notice>
              <ExpireButton narrative={narrative} owner={owner} onDone={refresh} />
            </div>
          ) : (
            <BuyPanel
              narrative={narrative}
              position={position}
              owner={owner}
              stockPrice={price}
              onDone={refresh}
            />
          )}
        </Card>

        {/* Position */}
        {owner && held > 0n && narrative.status !== Status.Expired ? (
          <Card>
            <div className="grid grid-cols-2 gap-6">
              <Stat
                label="You hold"
                value={held.toLocaleString()}
                sub={`$${narrative.symbol}`}
              />
              <Stat
                label="Worth at expiry"
                value={
                  <>
                    {formatStock(
                      supply > 0n ? (backing * held) / supply : 0n,
                      stock.decimals,
                      4,
                    )}
                    <span className="ml-1.5 text-sm font-normal text-neutral-400">
                      {stock.symbol}
                    </span>
                  </>
                }
                sub="if nothing else changes"
              />
            </div>
          </Card>
        ) : null}

        {/* About */}
        <Card className="space-y-4">
          {narrative.meta?.description ? (
            <p className="text-sm leading-relaxed text-neutral-600">
              {narrative.meta.description}
            </p>
          ) : null}

          <dl className="divide-y divide-neutral-100 text-sm">
            <Row label="Expires">
              <span className="numeric">{formatDate(narrative.expiryTs)}</span>
              <span className="ml-2 text-xs text-neutral-400">
                fixed at creation
              </span>
            </Row>
            <Row label="Created">
              <span className="numeric">{formatDate(narrative.createdTs)}</span>
            </Row>
            <Row label="Creator">
              <a
                href={explorerUrl(narrative.creator)}
                target="_blank"
                rel="noreferrer"
                className="numeric inline-flex items-center gap-1 hover:text-neutral-900"
              >
                {shortAddress(narrative.creator)}
                <ExternalLink className="h-3 w-3" />
              </a>
              {creatorHoldings !== null ? (
                <span className="ml-2 text-xs text-neutral-400">
                  holds {creatorHoldings.toLocaleString()}{" "}
                  {supply > 0n
                    ? `(${((Number(creatorHoldings) / Number(supply)) * 100).toFixed(1)}%)`
                    : ""}
                </span>
              ) : null}
            </Row>
            <Row label="Creator fee">
              <span className="numeric">
                {(narrative.feeBps / 100).toFixed(2)}%
              </span>
              <span className="ml-2 text-xs text-neutral-400">on every buy</span>
            </Row>
            <Row label="Exit tax">
              <span className="numeric">
                {(narrative.sellTaxBps / 100).toFixed(0)}%
              </span>
              <span className="ml-2 text-xs text-neutral-400">
                stays in the vault for holders who remain
              </span>
            </Row>
            <Row label="Token">
              <a
                href={explorerUrl(narrative.narrativeMint)}
                target="_blank"
                rel="noreferrer"
                className="numeric inline-flex items-center gap-1 hover:text-neutral-900"
              >
                {shortAddress(narrative.narrativeMint)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </Row>
          </dl>

          {narrative.meta?.website ||
          narrative.meta?.twitter ||
          narrative.meta?.telegram ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {narrative.meta.website ? (
                <LinkChip href={narrative.meta.website}>Website</LinkChip>
              ) : null}
              {narrative.meta.twitter ? (
                <LinkChip href={narrative.meta.twitter}>X</LinkChip>
              ) : null}
              {narrative.meta.telegram ? (
                <LinkChip href={narrative.meta.telegram}>Telegram</LinkChip>
              ) : null}
            </div>
          ) : null}
        </Card>

        <p className="px-1 text-sm leading-relaxed text-neutral-400">
          Your payout is the vault split evenly across every token. You gain if
          the narrative kept growing after you bought, and you receive{" "}
          {stock.symbol} either way. Nothing here checks whether the story came
          true: payoff follows flows, not facts.
        </p>
      </div>
    </Shell>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-neutral-400">{label}</dt>
      <dd className="min-w-0 text-right text-neutral-600">{children}</dd>
    </div>
  );
}

function LinkChip({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
