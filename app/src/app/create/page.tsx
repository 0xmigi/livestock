"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
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

import {
  Button,
  Card,
  Field,
  Notice,
  Shell,
  inputClass,
} from "@/components/ui";
import { ConnectButton, useOwner } from "@/components/wallet";
import {
  formatUsd,
  rpc,
  SOLANA_CHAIN,
  STOCK_DECIMALS,
  STOCK_MINT,
  STOCK_SYMBOL,
} from "@/lib/config";
import { fetchStockTokenProgram } from "@/lib/narratives";
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
  const { price } = useStockPrice();
  const fileInput = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].secs);
  const [advanced, setAdvanced] = useState(false);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Curve defaults derived from the stock price, so the first token lands near
  // $0.10 and reaches roughly $10 by a million, whatever the stock trades at.
  const basePrice = usdToStock(0.1, price, STOCK_DECIMALS);
  const slope =
    (usdToStock(10, price, STOCK_DECIMALS) - basePrice) / 1_000_000n;

  const valid =
    image !== null &&
    name.trim().length > 0 &&
    name.length <= 32 &&
    symbol.trim().length > 0 &&
    symbol.length <= 10 &&
    basePrice > 0n &&
    slope > 0n;

  const pickImage = (file: File | null) => {
    setImage(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  };

  const create = async () => {
    if (!owner || !STOCK_MINT || !image) return;
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

      // 1. Image and JSON first — the mint needs the URI baked in.
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
      const stockTokenProgram = await fetchStockTokenProgram(STOCK_MINT);
      const [vault] = await findVault(
        narrative,
        STOCK_MINT,
        stockTokenProgram,
      );

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
            mint: STOCK_MINT,
            tokenProgram: stockTokenProgram,
          }),
          getCreateNarrativeInstruction({
            creator: owner,
            narrative,
            stockMint: STOCK_MINT,
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
    <Shell action={<ConnectButton />}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Create a narrative
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            Name one thing you think is about to happen, and set the date it
            resolves into {STOCK_SYMBOL}.
          </p>
        </div>

        {!STOCK_MINT ? (
          <Notice kind="error">
            Set <code>NEXT_PUBLIC_STOCK_MINT</code> before creating.
          </Notice>
        ) : null}

        <Card className="space-y-5">
          {/* Image */}
          <Field label="Image" hint="PNG, JPEG, WebP or GIF. Up to 4MB.">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-rule bg-fill transition-colors hover:border-ink-faint"
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-ink-faint">Add</span>
                )}
              </button>
              <div className="min-w-0 text-xs text-ink-faint">
                {image ? (
                  <>
                    <div className="truncate text-ink">{image.name}</div>
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
            hint="Fixed at creation. Nobody can move it afterwards, including you."
          >
            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setDuration(d.secs)}
                  className={`flex-1 rounded-full px-3 py-2.5 text-sm font-medium transition-colors ${
                    duration === d.secs
                      ? "bg-ink text-white"
                      : "bg-fill text-ink-soft hover:bg-rule"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Links */}
          <div className="space-y-3 border-t border-rule pt-5">
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

          {/* Terms */}
          <div className="border-t border-rule pt-4">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="label transition-colors hover:text-ink"
            >
              {advanced ? "Hide" : "Show"} curve settings
            </button>

            {advanced ? (
              <div className="mt-3 space-y-1.5 text-xs text-ink-faint">
                <Row label="Starting price">
                  {formatStock(basePrice, STOCK_DECIMALS, 6)} {STOCK_SYMBOL} ≈{" "}
                  {formatUsd(0.1)}
                </Row>
                <Row label="Backed by">{STOCK_SYMBOL}</Row>
                <Row label="Decimals">0 — whole tokens only</Row>
                <Row label="Your fee on every buy">{FEE_BPS / 100}%</Row>
                <Row label="Exit tax, paid to holders who stay">
                  {SELL_TAX_BPS / 100}%
                </Row>
              </div>
            ) : null}
          </div>
        </Card>

        {!ready ? null : !authenticated || !owner ? (
          <Button onClick={login} className="w-full">
            Connect to create
          </Button>
        ) : (
          <Button
            onClick={create}
            disabled={busy || !valid || !STOCK_MINT}
            className="w-full"
          >
            {busy ? (step ?? "Creating…") : "Launch narrative"}
          </Button>
        )}

        {error ? <Notice kind="error">{error}</Notice> : null}
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
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="numeric text-right">{children}</span>
    </div>
  );
}
