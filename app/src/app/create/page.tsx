"use client";

/**
 * Create, as four short steps: the stock, the story, the date, then review.
 * Every step is a screen you can finish in seconds; the launch itself is one
 * transaction that builds the mint, the vault and the narrative.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";
import {
  findNarrative,
  findVault,
  formatStock,
  getCreateNarrativeInstruction,
  getCreateNarrativeMintInstructions,
  getNarrativeMintSize,
  usdToStock,
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
  DEFAULT_STOCK,
  formatUsd,
  formatUsdAuto,
  rpc,
  SOLANA_CHAIN,
  STOCKS,
  type StockInfo,
} from "@/lib/config";
import { fetchStockTokenProgram, formatDate } from "@/lib/narratives";
import { useStockMeta } from "@/lib/logos";
import { useStockPrice } from "@/lib/price";
import { signAndSend, toUserMessage } from "@/lib/tx";

const DURATIONS = [
  { label: "1 week", secs: 7 * 24 * 3600 },
  { label: "2 weeks", secs: 14 * 24 * 3600 },
  { label: "1 month", secs: 30 * 24 * 3600 },
];

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
  { id: "story", label: "Story" },
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
  const [stock, setStock] = useState<StockInfo | null>(DEFAULT_STOCK);
  const { price, isLive } = useStockPrice(stock?.mint);

  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [source, setSource] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].secs);
  const [showCurve, setShowCurve] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decimals = stock?.decimals ?? 8;

  // Curve defaults derived from the stock price, so the first token lands near
  // $0.10 and reaches roughly $10 by a million, whatever the stock trades at.
  const basePrice = usdToStock(0.1, price, decimals);
  const slope = (usdToStock(10, price, decimals) - basePrice) / 1_000_000n;
  const params = { basePrice, slope };
  const toUsd = (units: bigint) => (Number(units) / 10 ** decimals) * price;

  const storyValid =
    image !== null &&
    name.trim().length > 0 &&
    name.length <= 32 &&
    symbol.trim().length > 0 &&
    symbol.length <= 10;
  const valid = stock !== null && storyValid && basePrice > 0n && slope > 0n;

  const expiryPreview = Math.floor(Date.now() / 1000) + duration;
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
      form.set("description", "");
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

      const expiryTs = BigInt(Math.floor(Date.now() / 1000) + duration);

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
            basePrice,
            slope,
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
        [mint],
      );

      router.push(`/n/${narrative}`);
    } catch (cause) {
      setError(toUserMessage(cause));
      setBusy(false);
      setProgress(null);
    }
  };

  const previewCard = (
    <div className="flex items-center gap-3 rounded border border-neutral-200 bg-neutral-50 p-3.5">
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
    <div className="flex items-center gap-3 rounded border border-neutral-200 bg-neutral-50 p-2.5 pl-4">
      <div className="min-w-0 flex-1 truncate text-sm text-neutral-400">
        {step === "stock" && stock
          ? `Converts to ${stock.symbol}`
          : step === "story"
            ? name.trim()
              ? `${name.trim()} · $${symbol || "TICKER"}`
              : "Name the story"
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
        <Button variant="accent" size="lg" onClick={login}>
          Log in to launch
        </Button>
      ) : (
        <Button
          variant="accent"
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

        {STOCKS.length === 0 ? (
          <Notice kind="error">
            Set <code>NEXT_PUBLIC_STOCKS</code> or <code>NEXT_PUBLIC_STOCK_MINT</code>{" "}
            before creating.
          </Notice>
        ) : null}

        {step === "stock" ? (
          <section className="space-y-6">
            <header>
              <h1 className="display text-2xl text-neutral-900">Pick the underlying</h1>
              <p className="mt-2 text-[15px] text-neutral-400">
                Every buy is paid in it and every token turns back into it on the date.
              </p>
            </header>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {STOCKS.map((s) => (
                <StockOption key={s.mint} stock={s} active={stock?.mint === s.mint} onPick={() => setStock(s)} />
              ))}
            </div>
            {action}
          </section>
        ) : null}

        {step === "story" ? (
          <section className="space-y-6">
            <header>
              <h1 className="display text-2xl text-neutral-900">Name the story</h1>
              <p className="mt-2 text-[15px] text-neutral-400">
                One thing you think {stock ? stock.symbol.replace(/x$/i, "") : "the company"} is about
                to do. This is how it shows up everywhere.
              </p>
            </header>

            <div className="lg:hidden">{previewCard}</div>

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Name" hint="Up to 32 characters.">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 32))}
                  className={inputClass}
                  placeholder="Robotaxi Austin"
                  autoFocus
                />
              </Field>
              <Field label="Ticker" hint="Up to 10.">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase().slice(0, 10))}
                  className={`${inputClass} mono`}
                  placeholder="RBTX"
                />
              </Field>
            </div>

            <Field label="Image" hint="PNG, JPEG, WebP or GIF up to 4MB. This is what wallets and feeds show.">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 transition-colors hover:border-neutral-400"
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="h-6 w-6" strokeWidth={1.5} />
                  )}
                </button>
                <div className="min-w-0 text-xs text-neutral-400">
                  {image ? (
                    <>
                      <div className="truncate text-neutral-900">{image.name}</div>
                      <button type="button" onClick={() => pickImage(null)} className="mt-1 underline underline-offset-2">
                        Remove
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => fileInput.current?.click()} className="underline underline-offset-2">
                      Choose an image
                    </button>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
                />
              </div>
            </Field>

            <Field label="Source" optional hint="An X post, a website or a Telegram link. We work out which.">
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
                const when = Math.floor(Date.now() / 1000) + d.secs;
                return (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => setDuration(d.secs)}
                    aria-pressed={on}
                    className={`rounded border p-4 text-left transition-colors ${
                      on
                        ? "border-accent bg-neutral-100"
                        : "border-neutral-200 bg-neutral-50 hover:border-neutral-300"
                    }`}
                  >
                    <div className="display text-lg text-neutral-900">{d.label}</div>
                    <div className="mono mt-1 text-xs text-neutral-400">{formatDate(when)}</div>
                  </button>
                );
              })}
            </div>

            <div className="rounded border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-neutral-900">Price curve</div>
                  <div className="mt-0.5 text-xs text-neutral-400">
                    Set from {stock?.symbol ?? "the stock"}&apos;s price so the first token is about ten cents.
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setShowCurve((v) => !v)}>
                  {showCurve ? "Hide" : "Show"}
                </Button>
              </div>
              {showCurve && stock ? (
                <div className="mt-4 space-y-4">
                  <CurvePreview params={params} stockPriceUsd={price} stockDecimals={decimals} stockSymbol={stock.symbol} />
                  <dl className="mono space-y-1.5 border-t border-neutral-200 pt-4 text-xs">
                    <Term label="Starting price">
                      {formatStock(basePrice, decimals, 6)} {stock.symbol}
                    </Term>
                    <Term label="Slope">{slope.toString()} base units per token</Term>
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
                title="Terms"
                aside={`${stock.symbol} ${formatUsd(price)}${isLive ? "" : " est."}`}
                columns={3}
              >
                <Tile label="Converts to" value={stock.symbol} sub="paid in, paid out" />
                <Tile label="Converts on" value={formatDate(expiryPreview).split(",")[0]} sub={formatDate(expiryPreview).split(",")[1]?.trim()} />
                <Tile label="First token" value={formatUsdAuto(toUsd(basePrice))} sub={`${formatStock(basePrice, decimals, 6)} ${stock.symbol}`} />
                <Tile label="Your fee" value={`${(FEE_BPS / 100).toFixed(2)}%`} sub="on every buy" />
                <Tile label="Exit tax" value={`${SELL_TAX_BPS / 100}%`} sub="kept in the vault" />
                <Tile label="Curve" value="Linear" sub="no cap on supply" />
              </Overview>
            ) : null}

            {!storyValid ? (
              <Notice kind="warning">
                The story step still needs {!image ? "an image" : "a name and ticker"}.
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
        <div className="rounded border border-neutral-200 bg-neutral-50 p-4">
          <dl className="space-y-2.5 text-sm">
            <Summary label="Converts to">{stock ? stock.symbol : "—"}</Summary>
            <Summary label="Converts on">{formatDate(expiryPreview)}</Summary>
            <Summary label="First token">{stock && price > 0 ? formatUsdAuto(toUsd(basePrice)) : "—"}</Summary>
            <Summary label="Your fee">{(FEE_BPS / 100).toFixed(2)}% on every buy</Summary>
            <Summary label="Exit tax">{SELL_TAX_BPS / 100}% kept in the vault</Summary>
            <Summary label="Curve">Linear, no cap</Summary>
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
  const meta = useStockMeta();
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-3 rounded border p-4 text-left transition-colors ${
        active ? "border-accent bg-neutral-100" : "border-neutral-200 bg-neutral-50 hover:border-neutral-300"
      }`}
    >
      <StockLogo stock={stock} size={36} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-neutral-900">
          {meta[stock.mint]?.name ?? stock.symbol}
        </span>
        <span className="mono block text-xs text-neutral-400">
          {stock.symbol} · {price > 0 ? formatUsd(price) : "—"}
          {isLive ? "" : " est."}
        </span>
      </span>
    </button>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="mono text-right text-neutral-900">{children}</dd>
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
