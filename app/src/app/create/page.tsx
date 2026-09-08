"use client";

/**
 * Create, as four short steps: the stock, the narrative, the date, then review.
 * Every step is a screen you can finish in seconds; the launch itself is one
 * transaction that builds the mint, the vault and the narrative.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { Check, ChevronLeft, ChevronRight, ImagePlus, Search } from "lucide-react";
import {
  findNarrative,
  findVault,
  formatStock,
  getCreateNarrativeInstruction,
  getCreateNarrativeMintInstructions,
  getNarrativeMintSize,
  initialVirtualStock,
  openingState,
  spotPrice,
} from "@nm/client";
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import { createNoopSigner, generateKeyPairSigner } from "@solana/kit";

import { CurvePreview } from "@/components/curve-preview";
import { Shell } from "@/components/shell";
import { Thumb } from "@/components/thumb";
import {
  Button,
  Field,
  inputClass,
  Notice,
  Overview,
  StockLogo,
  Tile,
} from "@/components/ui";
import { useOwner } from "@/components/wallet";
import {
  BIO_MAX_CHARS,
  formatUsd,
  formatUsdAuto,
  formatUsdCompact,
  rpc,
  SOLANA_CHAIN,
  type StockInfo,
} from "@/lib/config";
import { fetchStockTokenProgram, formatDate } from "@/lib/narratives";
import { useStockPrice } from "@/lib/price";
import { matchesStock, useSolPrice, useStocks } from "@/lib/stocks";
import { signAndSend, toUserMessage } from "@/lib/tx";

// From the program's one-hour minimum up to two weeks. Short ones exist so a
// whole lifecycle can be walked through in an afternoon.
//
// The program measures the duration from when the transaction executes, not
// from when the button was pressed, so every expiry gets a small head start:
// without it "1 hour" lands a few seconds under the minimum and is rejected.
const LEAD_SECS = 120;

const DURATIONS = [
  { label: "1 hour", secs: 3600 },
  { label: "4 hours", secs: 4 * 3600 },
  { label: "1 day", secs: 24 * 3600 },
  { label: "3 days", secs: 3 * 24 * 3600 },
  { label: "1 week", secs: 7 * 24 * 3600 },
  { label: "2 weeks", secs: 14 * 24 * 3600 },
];

/** The picker scrolls through the whole catalogue; a search narrows it. */
const PICKER_MATCHES = 60;

/** 10% is the dial that decides whether people hold to expiry. */
const SELL_TAX_BPS = 1_000;
const FEE_BPS = 100;

/** One pasted link becomes the right metadata key from its host. */
function classifySource(raw: string): { website: string; twitter: string; telegram: string } {
  const out = { website: "", twitter: "", telegram: "" };
  const value = raw.trim();
  if (!value) return out;
  const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return out;
  }
  if (host === "x.com" || host === "twitter.com") out.twitter = url;
  else if (host === "t.me" || host === "telegram.me") out.telegram = url;
  else out.website = url;
  return out;
}

type Step = "stock" | "story" | "date" | "review";
const STEPS: { id: Step; label: string }[] = [
  { id: "stock", label: "Stock" },
  { id: "story", label: "Narrative" },
  { id: "date", label: "Date" },
  { id: "review", label: "Review" },
];

export default function Create() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const owner = useOwner();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("stock");
  const { stocks, loaded: stocksLoaded, error: stocksError } = useStocks();
  const [picked, setStock] = useState<StockInfo | null>(null);
  const [stockQuery, setStockQuery] = useState("");
  // The pick is remembered by mint and read back from the live list, so the
  // pins that seed the list before the registry answers never go stale.
  const stock = useMemo(
    () => (picked ? (stocks.find((s) => s.mint === picked.mint) ?? picked) : null),
    [stocks, picked],
  );
  const { price, isLive } = useStockPrice(stock?.mint);

  // `?stock=TSLAx` from a link picks that one; otherwise the first usable
  // stock is picked for you once the registry is in.
  useEffect(() => {
    if (picked) return;
    const wanted = new URLSearchParams(window.location.search).get("stock")?.toUpperCase();
    const asked = wanted ? stocks.find((s) => s.available && s.symbol.toUpperCase() === wanted) : null;
    const first = asked ?? stocks.find((s) => s.available);
    if (first) setStock(first);
  }, [stocks, picked]);

  // The whole catalogue, deepest first, in a window you scroll. A search
  // narrows it. Order never changes on a pick: a card that jumps around
  // reads as a glitch, not a selection.
  const pickerStocks = useMemo(() => {
    const q = stockQuery.trim();
    return q ? stocks.filter((s) => matchesStock(s, q)).slice(0, PICKER_MATCHES) : stocks;
  }, [stocks, stockQuery]);

  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [bio, setBio] = useState("");
  const [source, setSource] = useState("");
  const [duration, setDuration] = useState(DURATIONS[2].secs);
  const [showCurve, setShowCurve] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decimals = stock?.decimals ?? 8;

  // The curve is pump.fun's. Its one free parameter is the opening stock
  // reserve: 30 SOL in the stock, so every narrative opens at pump.fun's
  // market cap whatever the stock trades at.
  const solUsd = useSolPrice();
  const virtualStock =
    solUsd !== null && solUsd > 0 && price > 0 ? initialVirtualStock(solUsd, price, decimals) : 0n;
  const curve = openingState(virtualStock);
  const toUsd = (units: bigint | number) => (Number(units) / 10 ** decimals) * price;
  const openingPrice = spotPrice(curve);

  const storyValid =
    image !== null &&
    name.trim().length > 0 &&
    name.length <= 32 &&
    symbol.trim().length > 0 &&
    symbol.length <= 10;
  const valid = stock !== null && storyValid && virtualStock > 0n;

  const expiryPreview = Math.floor(Date.now() / 1000) + duration + LEAD_SECS;
  const index = STEPS.findIndex((s) => s.id === step);
  const prev = STEPS[index - 1] ?? null;
  const next = STEPS[index + 1] ?? null;
  const canAdvance =
    step === "stock" ? stock !== null : step === "story" ? storyValid : true;

  const pickImage = (file: File | null) => {
    setImage(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  };

  const create = async () => {
    if (!owner || !stock || !image) return;
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) {
      setError("No Solana wallet connected.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const cleanName = name.trim();
      const cleanSymbol = symbol.trim().toUpperCase();

      // 1. Image and JSON first: the mint needs the URI baked in.
      setProgress("Uploading image");
      const form = new FormData();
      form.set("image", image);
      form.set("name", cleanName);
      form.set("symbol", cleanSymbol);
      // One source link; which kind it is can be told from the host.
      const links = classifySource(source);
      form.set("description", bio.trim());
      form.set("website", links.website);
      form.set("twitter", links.twitter);
      form.set("telegram", links.telegram);

      const response = await fetch("/api/upload", { method: "POST", body: form });
      const uploaded = (await response.json()) as { uri?: string; error?: string };
      if (!response.ok || !uploaded.uri) {
        throw new Error(uploaded.error ?? "Upload failed.");
      }

      // 2. The mint is a keypair, so the narrative address hangs off it.
      setProgress("Preparing the mint");
      const mint = await generateKeyPairSigner();
      const [narrative] = await findNarrative(mint.address);
      const stockTokenProgram = await fetchStockTokenProgram(stock.mint);
      const [vault] = await findVault(narrative, stock.mint, stockTokenProgram);

      // The metadata extension grows the mint after creation and takes no
      // payer, so it has to be funded for its final size up front.
      const { fundFor } = getNarrativeMintSize(cleanName, cleanSymbol, uploaded.uri);
      const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(fundFor)).send();

      const expiryTs = BigInt(Math.floor(Date.now() / 1000) + duration + LEAD_SECS);

      setProgress("Confirm in your wallet");
      await signAndSend(
        owner,
        [
          ...getCreateNarrativeMintInstructions({
            payer: createNoopSigner(owner),
            mint,
            narrative,
            name: cleanName,
            symbol: cleanSymbol,
            uri: uploaded.uri,
            lamports,
          }),
          // The program pins whatever vault it is handed rather than
          // allocating one, so it must exist by the time it runs.
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(owner),
            ata: vault,
            owner: narrative,
            mint: stock.mint,
            tokenProgram: stockTokenProgram,
          }),
          getCreateNarrativeInstruction({
            creator: owner,
            narrative,
            stockMint: stock.mint,
            narrativeMint: mint.address,
            vault,
            stockTokenProgram,
            name: cleanName,
            symbol: cleanSymbol,
            expiryTs,
            virtualStock,
            feeBps: FEE_BPS,
            sellTaxBps: SELL_TAX_BPS,
          }),
        ],
        async (transaction) => {
          const { signedTransaction } = await signTransaction({
            transaction,
            wallet,
            chain: SOLANA_CHAIN,
          });
          return signedTransaction;
        },
        // The mint signs its own CreateAccount; Privy adds the fee payer.
        { localSigners: [mint] },
      );

      router.push(`/n/${narrative}`);
    } catch (cause) {
      setError(toUserMessage(cause));
      setBusy(false);
      setProgress(null);
    }
  };

  const previewCard = (
    <div className="flex items-center gap-3 rounded bg-neutral-50 p-3.5">
      <Thumb src={preview ?? undefined} name={name || "?"} size={48} shape="square" />
      <div className="min-w-0 flex-1">
        <div className="display truncate text-lg leading-tight text-neutral-900">
          {name.trim() || <span className="text-neutral-300">Your narrative</span>}
        </div>
        <div className="mono mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
          <span>${symbol || "TICKER"}</span>
          {stock ? (
            <>
              <span aria-hidden>·</span>
              <StockLogo stock={stock} size={14} />
              <span>converts to {stock.symbol}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  const action = (
    <div className="flex items-center gap-3 rounded bg-neutral-50 p-2.5 pl-4">
      <div className="min-w-0 flex-1 truncate text-sm text-neutral-400">
        {step === "stock" && stock
          ? `Converts to ${stock.symbol}`
          : step === "story"
            ? name.trim()
              ? `${name.trim()} · $${symbol || "TICKER"}`
              : "Name the narrative"
            : step === "date"
              ? `Converts on ${formatDate(expiryPreview)}`
              : busy
                ? progress
                : "One transaction. Nothing can be changed after."}
      </div>
      {step !== "review" ? (
        <Button
          variant="primary"
          size="lg"
          disabled={!canAdvance}
          onClick={() => next && setStep(next.id)}
          className="px-6"
        >
          Continue
        </Button>
      ) : !ready ? null : !authenticated || !owner ? (
        <Button variant="primary" size="lg" onClick={login}>
          Log in to launch
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          onClick={create}
          disabled={busy || !valid}
        >
          {busy ? "Launching" : "Launch narrative"}
        </Button>
      )}
    </div>
  );

  return (
    <Shell>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="min-w-0 space-y-8">
        {/* Step bar */}
        <div>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => prev && setStep(prev.id)}
              disabled={!prev || busy}
              className="flex items-center gap-1 text-neutral-600 hover:text-neutral-900 disabled:invisible"
            >
              <ChevronLeft className="h-4 w-4" />
              {prev?.label}
            </button>
            <button
              type="button"
              onClick={() => next && canAdvance && setStep(next.id)}
              disabled={!next || !canAdvance || busy}
              className="flex items-center gap-1 text-neutral-600 hover:text-neutral-900 disabled:invisible"
            >
              {next?.label}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-1">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`h-0.5 flex-1 rounded-full ${i <= index ? "bg-neutral-900" : "bg-neutral-200"}`}
              />
            ))}
          </div>
        </div>

        {stocksLoaded && stocks.length === 0 ? (
          <Notice kind="error">{stocksError ?? "No stocks are listed right now."}</Notice>
        ) : null}

        {step === "stock" ? (
          <section className="space-y-6">
            <header>
              <h1 className="display text-2xl text-neutral-900">Pick the underlying</h1>
              <p className="mt-2 text-[15px] text-neutral-400">
                Every buy is paid in it and every token turns back into it on the date.
              </p>
            </header>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                placeholder="Search"
                className={`${inputClass} pl-9`}
                aria-label="Search stocks"
                autoFocus
              />
            </label>
            {pickerStocks.length === 0 ? (
              <p className="text-sm text-neutral-400">
                {stocksLoaded ? "Nothing matches." : "Loading the stock list."}
              </p>
            ) : (
              <div className="max-h-[27rem] overflow-y-auto rounded">
                <div className="grid grid-cols-2 gap-3 pb-1 pr-1 sm:grid-cols-3 md:grid-cols-4">
                  {pickerStocks.map((s) => (
                    <StockOption key={s.mint} stock={s} active={stock?.mint === s.mint} onPick={() => setStock(s)} />
                  ))}
                </div>
              </div>
            )}
            {action}
          </section>
        ) : null}

        {step === "story" ? (
          <section className="space-y-6">
            <header>
              <h1 className="display text-2xl text-neutral-900">Name the narrative</h1>
              <p className="mt-2 text-[15px] text-neutral-400">
                One thing you think {stock ? stock.symbol.replace(/x$/i, "") : "the company"} is about
                to do. This is how it shows up everywhere.
              </p>
            </header>

            {/* The picture first: it is what everyone sees, everywhere. */}
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="lift relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-50 text-neutral-400"
                aria-label={image ? "Change image" : "Choose an image"}
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-7 w-7" strokeWidth={1.5} />
                )}
              </button>
              <div className="min-w-0 space-y-1.5">
                <div className="text-sm font-medium text-neutral-900">
                  {image ? <span className="block truncate">{image.name}</span> : "Image"}
                </div>
                <div className="flex gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="text-link underline underline-offset-2"
                  >
                    {image ? "Change" : "Choose an image"}
                  </button>
                  {image ? (
                    <button
                      type="button"
                      onClick={() => pickImage(null)}
                      className="text-neutral-400 underline underline-offset-2"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="text-xs text-neutral-400">PNG, JPEG, WebP or GIF. Up to 4MB.</div>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 32))}
                  className={inputClass}
                  placeholder="Robotaxi Austin"
                  autoFocus
                />
              </Field>
              <Field label="Ticker">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase().slice(0, 10))}
                  className={`${inputClass} mono`}
                  placeholder="RBTX"
                />
              </Field>
            </div>

            <Field
              label="Bio"
              optional
              hint={bio.length > 0 ? `${bio.length}/${BIO_MAX_CHARS}` : undefined}
            >
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX_CHARS))}
                maxLength={BIO_MAX_CHARS}
                rows={3}
                className={`${inputClass} resize-none`}
                placeholder="What is the narrative, and why now?"
              />
            </Field>

            <Field label="Source" optional>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={`${inputClass} mono`}
                placeholder="https://x.com/…"
              />
            </Field>

            {action}
          </section>
        ) : null}

        {step === "date" ? (
          <section className="space-y-6">
            <header>
              <h1 className="display text-2xl text-neutral-900">Set the date</h1>
              <p className="mt-2 text-[15px] text-neutral-400">
                Trading stops and every token converts to {stock?.symbol ?? "the stock"}. Nobody can
                move it afterwards, including you.
              </p>
            </header>

            <div className="grid grid-cols-3 gap-3">
              {DURATIONS.map((d) => {
                const on = duration === d.secs;
                const when = Math.floor(Date.now() / 1000) + d.secs + LEAD_SECS;
                return (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => setDuration(d.secs)}
                    aria-pressed={on}
                    className={`relative rounded p-4 text-left transition-colors ${
                      on ? "bg-primary text-on-primary" : "lift bg-neutral-50"
                    }`}
                  >
                    {on ? <Picked /> : null}
                    <div className={`display text-lg ${on ? "text-on-primary" : "text-neutral-900"}`}>{d.label}</div>
                    <div className={`mono mt-1 text-xs ${on ? "text-on-primary/60" : "text-neutral-400"}`}>{formatDate(when)}</div>
                  </button>
                );
              })}
            </div>

            <div className="rounded bg-neutral-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-neutral-900">Price curve</div>
                  <div className="mt-0.5 text-xs text-neutral-400">
                    The pump.fun curve, priced in {stock?.symbol ?? "the stock"}. Opens at 30 SOL of
                    virtual liquidity, like every pump.fun launch.
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setShowCurve((v) => !v)}>
                  {showCurve ? "Hide" : "Show"}
                </Button>
              </div>
              {showCurve && stock ? (
                <div className="mt-4 space-y-4">
                  <CurvePreview curve={curve} stockPriceUsd={price} stockDecimals={decimals} stockSymbol={stock.symbol} />
                  <dl className="mono space-y-1.5 border-t border-neutral-100 pt-4 text-xs">
                    <Term label="Opening liquidity">
                      {formatStock(virtualStock, decimals, 4)} {stock.symbol} virtual
                    </Term>
                    <Term label="Total supply">1,000,000,000</Term>
                    <Term label="On the curve">793,100,000</Term>
                    <Term label="Decimals">0, whole tokens only</Term>
                    <Term label="Your fee on every buy">{FEE_BPS / 100}%</Term>
                    <Term label="Exit tax, kept for holders who stay">{SELL_TAX_BPS / 100}%</Term>
                  </dl>
                </div>
              ) : null}
            </div>
            {action}
          </section>
        ) : null}

        {step === "review" ? (
          <section className="space-y-6">
            <header>
              <h1 className="display text-2xl text-neutral-900">Review and launch</h1>
              <p className="mt-2 text-[15px] text-neutral-400">
                One transaction builds the token, its vault and the narrative. You can never withdraw
                from the vault, move the date, or mint outside the curve.
              </p>
            </header>

            <div className="lg:hidden">{previewCard}</div>

            {stock ? (
              <Overview
                className="lg:hidden"
                title="Terms"
                aside={`${stock.symbol} ${formatUsd(price)}${isLive ? "" : " est."}`}
                columns={3}
              >
                <Tile label="Converts to" value={stock.symbol} sub="paid in, paid out" />
                <Tile label="Converts on" value={formatDate(expiryPreview).split(",")[0]} sub={formatDate(expiryPreview).split(",")[1]?.trim()} />
                <Tile label="Opening price" value={formatUsdAuto(toUsd(openingPrice))} sub="per token" />
                <Tile label="Your fee" value={`${(FEE_BPS / 100).toFixed(2)}%`} sub="on every buy" />
                <Tile label="Exit tax" value={`${SELL_TAX_BPS / 100}%`} sub="kept in the vault" />
                <Tile label="Curve" value="pump.fun" sub="1B supply, 793.1M on the curve" />
              </Overview>
            ) : null}

            {!storyValid ? (
              <Notice kind="warning">
                The narrative step still needs {!image ? "an image" : "a name and ticker"}.
              </Notice>
            ) : null}
            {error ? <Notice kind="error">{error}</Notice> : null}
            {busy && progress ? <Notice>{progress}</Notice> : null}
            {action}
          </section>
        ) : null}
      </div>

      {/* What you are building, kept in view while you fill it in */}
      <aside className="hidden space-y-4 lg:sticky lg:top-6 lg:block">
        {previewCard}
        <div className="rounded bg-neutral-50 p-4">
          <dl className="space-y-2">
            <Summary label="Converts to">{stock ? stock.symbol : "—"}</Summary>
            {stock?.marketCapUsd ? (
              <Summary label="On-chain cap">{formatUsdCompact(stock.marketCapUsd)}</Summary>
            ) : null}
            {stock?.liquidityUsd ? (
              <Summary label="Liquidity">{formatUsdCompact(stock.liquidityUsd)}</Summary>
            ) : null}
            <Summary label="Converts on">{formatDate(expiryPreview)}</Summary>
            <Summary label="Opening price">{stock && virtualStock > 0n ? formatUsdAuto(toUsd(openingPrice)) : "—"}</Summary>
            <Summary label="Your fee">{(FEE_BPS / 100).toFixed(2)}% on every buy</Summary>
            <Summary label="Exit tax">{SELL_TAX_BPS / 100}% kept in the vault</Summary>
            <Summary label="Curve">pump.fun, 1B supply</Summary>
          </dl>
        </div>
        <p className="px-1 text-xs leading-relaxed text-neutral-400">
          One transaction builds the token, its vault and the narrative. Nothing can be changed
          after: not the vault, not the date, not the curve.
        </p>
      </aside>
      </div>
    </Shell>
  );
}

function StockOption({
  stock,
  active,
  onPick,
}: {
  stock: StockInfo;
  active: boolean;
  onPick: () => void;
}) {
  const { price, isLive } = useStockPrice(stock.mint);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!stock.available}
      aria-pressed={active}
      title={stock.available ? undefined : "Only on mainnet"}
      className={`relative flex flex-col items-start gap-3 rounded p-4 text-left transition-colors ${
        active ? "bg-primary text-on-primary" : "lift bg-neutral-50"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {active ? <Picked /> : null}
      <StockLogo stock={stock} size={36} />
      <span className="block w-full min-w-0">
        {/* Name and ticker share a line when they fit; the ticker wraps under otherwise. */}
        <span className="flex flex-wrap items-baseline gap-x-1.5 leading-tight">
          <span className={`min-w-0 truncate text-sm font-semibold ${active ? "text-on-primary" : "text-neutral-900"}`}>
            {stock.name}
          </span>
          <span className={`mono text-[11px] ${active ? "text-on-primary/50" : "text-neutral-400"}`}>{stock.symbol}</span>
        </span>
        <span
          className={`mono mt-1 block text-xs ${active ? "text-on-primary/80" : "text-neutral-600"}`}
          title={isLive ? undefined : "Estimated"}
        >
          {price > 0 ? `${isLive ? "" : "~"}${formatUsd(price)}` : "—"}
        </span>
        {stock.available ? null : (
          <span className={`mt-1 block text-[11px] ${active ? "text-on-primary/50" : "text-neutral-400"}`}>Mainnet only</span>
        )}
      </span>
    </button>
  );
}

/** The check in the corner of whatever is picked. Ink fill says it; the ochre badge is the trim. */
function Picked() {
  return (
    <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-accent">
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}

/** A stat row: label, a dotted leader, then the value. The dots say "this one varies". */
function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <dt className="shrink-0 text-neutral-400">{label}</dt>
      <span aria-hidden className="mb-[3px] min-w-3 flex-1 border-b border-dotted border-neutral-300" />
      <dd className="mono shrink-0 text-right text-neutral-900">{children}</dd>
    </div>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="text-right text-neutral-600">{children}</dd>
    </div>
  );
}
