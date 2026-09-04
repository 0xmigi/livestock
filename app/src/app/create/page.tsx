"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { ImagePlus } from "lucide-react";
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
import {
  Button,
  Card,
  Chip,
  Field,
  Notice,
  inputClass,
} from "@/components/ui";
import { useOwner } from "@/components/wallet";
import {
  DEFAULT_STOCK,
  formatUsd,
  rpc,
  SOLANA_CHAIN,
  STOCKS,
  type StockInfo,
} from "@/lib/config";
import { fetchStockTokenProgram, formatDate } from "@/lib/narratives";
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

export default function Create() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const owner = useOwner();
  const fileInput = useRef<HTMLInputElement>(null);

  const [stock, setStock] = useState<StockInfo | null>(DEFAULT_STOCK);
  const { price, isLive } = useStockPrice(stock?.mint);

  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].secs);
  const [showCurve, setShowCurve] = useState(false);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decimals = stock?.decimals ?? 8;

  // Curve defaults derived from the stock price, so the first token lands near
  // $0.10 and reaches roughly $10 by a million, whatever the stock trades at.
  const basePrice = usdToStock(0.1, price, decimals);
  const slope = (usdToStock(10, price, decimals) - basePrice) / 1_000_000n;
  const params = { basePrice, slope };

  const valid =
    stock !== null &&
    image !== null &&
    name.trim().length > 0 &&
    name.length <= 32 &&
    symbol.trim().length > 0 &&
    symbol.length <= 10 &&
    basePrice > 0n &&
    slope > 0n;

  const expiryPreview = Math.floor(Date.now() / 1000) + duration;

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
      setStep("Uploading image…");
      const form = new FormData();
      form.set("image", image);
      form.set("name", cleanName);
      form.set("symbol", cleanSymbol);
      form.set("description", description.trim());
      form.set("website", website.trim());
      form.set("twitter", twitter.trim());
      form.set("telegram", telegram.trim());

      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const uploaded = (await response.json()) as {
        uri?: string;
        error?: string;
      };
      if (!response.ok || !uploaded.uri) {
        throw new Error(uploaded.error ?? "Upload failed.");
      }

      // 2. The mint is a keypair, so the narrative address hangs off it.
      setStep("Preparing the mint…");
      const mint = await generateKeyPairSigner();
      const [narrative] = await findNarrative(mint.address);
      const stockTokenProgram = await fetchStockTokenProgram(stock.mint);
      const [vault] = await findVault(narrative, stock.mint, stockTokenProgram);

      // The metadata extension grows the mint after creation and takes no
      // payer, so it has to be funded for its final size up front.
      const { fundFor } = getNarrativeMintSize(
        cleanName,
        cleanSymbol,
        uploaded.uri,
      );
      const lamports = await rpc
        .getMinimumBalanceForRentExemption(BigInt(fundFor))
        .send();

      const expiryTs = BigInt(Math.floor(Date.now() / 1000) + duration);

      setStep("Confirm in your wallet…");
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
      setStep(null);
    }
  };

  return (
    <Shell width="narrow">
      <div className="space-y-8">
        <div className="space-y-1 pt-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Create a narrative
          </h1>
          <p className="text-[15px] text-neutral-400">
            Name one thing you think a company is about to do, and set the date
            it turns into that company&apos;s stock.
          </p>
        </div>

        {STOCKS.length === 0 ? (
          <Notice kind="error">
            Set <code>NEXT_PUBLIC_STOCKS</code> or{" "}
            <code>NEXT_PUBLIC_STOCK_MINT</code> before creating.
          </Notice>
        ) : null}

        <Card className="space-y-6 !p-5">
          {/* Stock */}
          <Field
            label="Expires into"
            hint={
              stock && price > 0 ? (
                <>
                  {stock.symbol} at {formatUsd(price)}
                  {isLive ? "" : " (estimated)"}. Every buy is paid in{" "}
                  {stock.symbol} and every token converts back into it.
                </>
              ) : (
                "The tokenized stock this narrative converts into."
              )
            }
          >
            <div className="scrollbar-hide flex gap-2 overflow-x-auto">
              {STOCKS.map((s) => (
                <Chip
                  key={s.mint}
                  active={stock?.mint === s.mint}
                  onClick={() => setStock(s)}
                  className="px-4 py-2 text-sm"
                >
                  {s.symbol}
                </Chip>
              ))}
            </div>
          </Field>

          {/* Image */}
          <Field label="Image" hint="PNG, JPEG, WebP or GIF. Up to 4MB.">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-400 transition-colors hover:border-neutral-300"
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImagePlus className="h-6 w-6" strokeWidth={1.5} />
                )}
              </button>
              <div className="min-w-0 text-xs text-neutral-400">
                {image ? (
                  <>
                    <div className="truncate text-neutral-900">{image.name}</div>
                    <button
                      type="button"
                      onClick={() => pickImage(null)}
                      className="mt-1 underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  "This is what shows in wallets and feeds."
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

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Name" hint="What is the story? Up to 32 characters.">
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 32))}
                className={inputClass}
                placeholder="Robotaxi Austin"
              />
            </Field>

            <Field label="Ticker" hint="Up to 10 characters.">
              <input
                value={symbol}
                onChange={(e) =>
                  setSymbol(e.target.value.toUpperCase().slice(0, 10))
                }
                className={`${inputClass} numeric`}
                placeholder="RBTX"
              />
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="Why this, and why now."
            />
          </Field>

          <Field
            label="Expires in"
            hint={
              <>
                Converts on{" "}
                <span className="numeric">{formatDate(expiryPreview)}</span>.
                Fixed at creation; nobody can move it afterwards, including
                you.
              </>
            }
          >
            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setDuration(d.secs)}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    duration === d.secs
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Links */}
          <div className="space-y-3 border-t border-neutral-100 pt-5">
            <Field label="Website">
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className={inputClass}
                placeholder="https://"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="X">
                <input
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  className={inputClass}
                  placeholder="https://x.com/…"
                />
              </Field>
              <Field label="Telegram">
                <input
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  className={inputClass}
                  placeholder="https://t.me/…"
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Curve */}
        <Card className="space-y-4 !p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-neutral-900">
                Price curve
              </div>
              <div className="mt-0.5 text-xs text-neutral-400">
                Set from {stock?.symbol ?? "the stock"}&apos;s price so the first
                token is about ten cents.
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCurve((v) => !v)}
            >
              {showCurve ? "Hide" : "Show"}
            </Button>
          </div>

          {showCurve && stock ? (
            <>
              <CurvePreview
                params={params}
                stockPriceUsd={price}
                stockDecimals={decimals}
                stockSymbol={stock.symbol}
              />
              <dl className="space-y-1.5 border-t border-neutral-100 pt-4 text-xs">
                <Term label="Starting price">
                  {formatStock(basePrice, decimals, 6)} {stock.symbol}
                </Term>
                <Term label="Slope">
                  {slope.toString()} base units per token
                </Term>
                <Term label="Decimals">0, whole tokens only</Term>
                <Term label="Your fee on every buy">{FEE_BPS / 100}%</Term>
                <Term label="Exit tax, kept for holders who stay">
                  {SELL_TAX_BPS / 100}%
                </Term>
              </dl>
            </>
          ) : null}
        </Card>

        {!ready ? null : !authenticated || !owner ? (
          <Button
            onClick={login}
            className="w-full !py-3.5 !text-base"
            size="lg"
          >
            Log in to create
          </Button>
        ) : (
          <Button
            onClick={create}
            disabled={busy || !valid}
            className="w-full !py-3.5 !text-base"
            size="lg"
          >
            {busy ? (step ?? "Creating…") : "Launch narrative"}
          </Button>
        )}

        {error ? <Notice kind="error">{error}</Notice> : null}

        <p className="px-1 text-sm leading-relaxed text-neutral-400">
          Launching creates the token and its vault in one transaction. You can
          never withdraw from the vault, move the date, or mint outside the
          curve; the program enforces all three.
        </p>
      </div>
    </Shell>
  );
}

function Term({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="numeric text-right text-neutral-600">{children}</dd>
    </div>
  );
}
