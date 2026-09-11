"use client";

/**
 * The hero's proof: the week's best narrative trade, played the way the
 * example plays. Somebody traded a story and ended up with more of the
 * stock than buying the stock would have given them. Real trade, read from
 * the chain, laid onto the example's clock. The whole card links to the
 * narrative for anyone who wants the detail; until there is a trade to
 * show, the example plays instead.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "@solana/kit";

import { stockFor } from "@/lib/config";
import { useStocks } from "@/lib/stocks";
import { tradeStory, type TradePoint } from "@/lib/story";
import { Explainer } from "./explainer";

type Highlight = {
  found: true;
  narrative: {
    address: Address;
    name: string;
    symbol: string;
    stockMint: Address;
    stockDecimals: number;
    createdTs: number;
    expiryTs: number;
    sellTaxBps: number;
  };
  series: TradePoint[];
  trade: {
    owner: Address;
    tokens: number;
    paid: number;
    received: number;
    boughtAt: number;
    exitedAt: number;
    exit: "sold" | "converted";
  };
};

function useHighlight(): Highlight | null | undefined {
  const [state, setState] = useState<Highlight | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/highlight")
      .then((r) => r.json())
      .then((body: Highlight | { found: false }) => {
        if (!cancelled) setState(body.found ? body : null);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function Highlight({ fallback }: { fallback: React.ReactNode }) {
  const h = useHighlight();
  // The registry names the stock; the story is rebuilt once it has loaded.
  const { stocks } = useStocks();
  const story = useMemo(() => {
    if (!h) return null;
    const stock = stockFor(h.narrative.stockMint, h.narrative.stockDecimals);
    return tradeStory({
      series: h.series,
      boughtAt: h.trade.boughtAt,
      exitedAt: h.trade.exitedAt,
      exit: h.trade.exit,
      owner: h.trade.owner,
      multiple: h.trade.paid > 0 ? h.trade.received / h.trade.paid : 0,
      stockSymbol: stock.symbol,
      narrativeSymbol: `$${h.narrative.symbol}`,
      narrativeName: h.narrative.name,
      durationSecs: h.narrative.expiryTs - h.narrative.createdTs,
    });
    // `stocks` is what changes the symbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, stocks]);

  // While the lookup is in flight the fallback shows; a real trade, when
  // there is one the series can carry, replaces it. Nothing waits on the network to appear.
  if (!story || !h) return <>{fallback}</>;

  return (
    <Link href={`/n/${h.narrative.address}`} className="lift block rounded">
      <Explainer story={story} />
    </Link>
  );
}
