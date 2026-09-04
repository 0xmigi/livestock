"use client";

import { use } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  formatStock,
  isPastExpiry,
  isTradable,
  redemptionPerToken,
  secondsRemaining,
  spotPrice,
  Status,
} from "@nm/client";
import { address } from "@solana/kit";

import { BuyPanel, RedeemPanel } from "@/components/actions";
import { Button, Card, Notice, Shell, Stat, StatusDot } from "@/components/ui";
import { ConnectButton, useOwner } from "@/components/wallet";
import { formatUsd, STOCK_DECIMALS, STOCK_SYMBOL } from "@/lib/config";
import { formatCountdown, useNarrative, useNow } from "@/lib/narratives";
import { useStockPrice } from "@/lib/price";
import { ExpireButton } from "@/components/expire";

export default function NarrativePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = use(params);
  const { authenticated, login, ready } = usePrivy();
  const owner = useOwner();
  const now = useNow();
  const { price } = useStockPrice();

  let parsed = null;
  try {
    parsed = address(raw);
  } catch {
    // handled below
  }

  const { narrative, position, error, loading, refresh } = useNarrative(
    parsed,
    owner,
  );

  if (!parsed) {
    return (
      <Shell action={<ConnectButton />}>
        <Notice kind="error">That is not a valid address.</Notice>
      </Shell>
    );
  }

  if (loading && !narrative) {
    return (
      <Shell action={<ConnectButton />}>
        <p className="text-sm text-ink-faint">Loading…</p>
      </Shell>
    );
  }

  if (!narrative) {
    return (
      <Shell action={<ConnectButton />}>
        <Notice kind="error">{error ?? "Narrative not found."}</Notice>
      </Shell>
    );
  }

  const remaining = secondsRemaining(narrative, now);
  const pastExpiry = isPastExpiry(narrative, now);
  const tradable = isTradable(narrative, now);
  const perToken = redemptionPerToken(narrative);

  // Before expiry the vault is live; after, the frozen snapshot is what pays.
  const backing =
    narrative.status === Status.Live
      ? narrative.vaultBalance
      : narrative.finalVault;
  const backingUsd = (Number(backing) / 10 ** STOCK_DECIMALS) * price;

  return (
    <Shell action={<ConnectButton />}>
      <div className="space-y-5">
        {/* Hero */}
        <div>
          <div className="flex items-center gap-3">
            <StatusDot status={narrative.status} expired={pastExpiry} />
            <span className="text-xs text-ink-faint">
              expires into {STOCK_SYMBOL}
            </span>
          </div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
            {narrative.name}
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            {narrative.symbol}
          </p>
        </div>

        {/* The two numbers that are the product, plus the clock */}
        <Card>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Stat
              label={tradable ? "Expires in" : "Trading"}
              value={tradable ? formatCountdown(remaining) : "Closed"}
            />
            <Stat
              label="Vault"
              value={formatStock(backing, STOCK_DECIMALS, 2)}
              sub={`≈ ${formatUsd(backingUsd)}`}
            />
            <Stat
              label="Supply"
              value={(narrative.status === Status.Live
                ? narrative.supply
                : narrative.finalSupply
              ).toLocaleString()}
              sub={
                perToken > 0n
                  ? `${formatStock(perToken, STOCK_DECIMALS, 6)} each`
                  : `${formatStock(spotPrice(narrative.supply, narrative), STOCK_DECIMALS, 6)} next`
              }
            />
          </div>
        </Card>

        {/* Action */}
        <Card>
          {!ready ? (
            <p className="text-sm text-ink-faint">…</p>
          ) : !authenticated || !owner ? (
            <div className="py-6 text-center">
              <p className="text-sm text-ink-soft">
                Connect a wallet to take part.
              </p>
              <Button onClick={login} className="mt-4">
                Connect
              </Button>
            </div>
          ) : narrative.status === Status.Settled ? (
            <Notice>
              This narrative is fully settled. Every claim has been converted.
            </Notice>
          ) : narrative.status === Status.Expired ? (
            <RedeemPanel
              narrative={narrative}
              position={position}
              owner={owner}
              stockPrice={price}
              onDone={refresh}
            />
          ) : pastExpiry ? (
            <div className="space-y-4">
              <Notice>
                The date has passed and trading has stopped. Someone needs to
                settle it before claims open — anyone can, including you.
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
        {position && position.tokens > 0n ? (
          <Card>
            <div className="grid grid-cols-2 gap-6">
              <Stat
                label="You hold"
                value={position.tokens.toLocaleString()}
                sub={narrative.symbol}
              />
              <Stat
                label={`Your ${STOCK_SYMBOL}`}
                value={formatStock(position.stockBalance, STOCK_DECIMALS, 2)}
              />
            </div>
          </Card>
        ) : null}

        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          Buy the story. When it expires, you get the stock. Your payout is the
          vault split across every token — so you gain if the narrative kept
          growing after you bought, and you still receive {STOCK_SYMBOL} either
          way.
        </p>
      </div>
    </Shell>
  );
}
