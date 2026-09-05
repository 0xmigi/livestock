"use client";

/**
 * Edit what is not on chain: the image, the description, the source link.
 * The creator signs a short message to prove it is them; the server rewrites
 * the metadata JSON in place, so the mint's URI stays what it was.
 */

import { useRef, useState } from "react";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";
import { ImagePlus } from "lucide-react";
import { getBase64Decoder, getUtf8Encoder, type Address } from "@solana/kit";

import { BIO_MAX_CHARS } from "@/lib/config";
import { invalidateTokenMeta } from "@/lib/metadata";
import type { NarrativeRow } from "@/lib/narratives";
import { Thumb } from "./thumb";
import { Button, Field, inputClass, Notice } from "./ui";

/** Mirrors the server: what the wallet signs. */
function editMessage(mint: string, issuedAt: number): string {
  return `Livestock\nUpdate narrative ${mint}\nAt ${issuedAt}`;
}

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

export function EditNarrative({
  narrative,
  owner,
  onDone,
}: {
  narrative: NarrativeRow;
  owner: Address;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (owner !== narrative.creator) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open ? <EditDialog narrative={narrative} owner={owner} onClose={() => setOpen(false)} onDone={onDone} /> : null}
    </>
  );
}

function EditDialog({
  narrative,
  owner,
  onClose,
  onDone,
}: {
  narrative: NarrativeRow;
  owner: Address;
  onClose: () => void;
  onDone: () => void;
}) {
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const fileInput = useRef<HTMLInputElement>(null);

  const meta = narrative.meta;
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [description, setDescription] = useState(meta?.description ?? "");
  const [source, setSource] = useState(meta?.twitter ?? meta?.website ?? meta?.telegram ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = (file: File | null) => {
    setImage(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  };

  const save = async () => {
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) {
      setError("No Solana wallet connected.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const issuedAt = Date.now();
      const { signature } = await signMessage({
        message: new Uint8Array(getUtf8Encoder().encode(editMessage(narrative.narrativeMint, issuedAt))),
        wallet,
      });

      const form = new FormData();
      form.set("owner", owner);
      form.set("issuedAt", String(issuedAt));
      form.set("signature", getBase64Decoder().decode(signature));
      form.set("description", description);
      const links = classifySource(source);
      form.set("website", links.website);
      form.set("twitter", links.twitter);
      form.set("telegram", links.telegram);
      if (image) form.set("image", image);

      const response = await fetch(`/api/narrative/${narrative.narrativeMint}`, { method: "POST", body: form });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The update failed.");

      invalidateTokenMeta(narrative.narrativeMint);
      onDone();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/40" onClick={busy ? undefined : onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={`Edit ${narrative.name}`}
        className="relative w-full max-w-md space-y-5 rounded border border-neutral-200 bg-ground p-5 shadow-xl sm:p-6"
      >
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Edit {narrative.name}</h2>
          <p className="mt-1 text-sm text-neutral-400">
            The name, ticker, stock and date are on chain and stay as they are.
          </p>
        </div>

        <Field label="Image" hint="PNG, JPEG, WebP or GIF up to 4MB.">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 transition-colors hover:border-neutral-400"
              aria-label="Choose a new image"
            >
              {preview || meta?.image ? (
                <Thumb src={preview ?? meta?.image} name={narrative.name} size={64} shape="square" />
              ) : (
                <ImagePlus className="h-5 w-5" strokeWidth={1.5} />
              )}
            </button>
            <div className="text-xs text-neutral-400">
              {image ? (
                <>
                  <div className="truncate text-neutral-900">{image.name}</div>
                  <button type="button" onClick={() => pickImage(null)} className="mt-1 underline underline-offset-2">
                    Keep the current one
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => fileInput.current?.click()} className="underline underline-offset-2">
                  Choose a new image
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

        <Field
          label="Bio"
          optional
          hint={
            <span className={description.length >= BIO_MAX_CHARS ? "text-neutral-900" : undefined}>
              {description.length}/{BIO_MAX_CHARS}
            </span>
          }
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, BIO_MAX_CHARS))}
            maxLength={BIO_MAX_CHARS}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="What is the narrative, and why now?"
          />
        </Field>

        <Field label="Source" optional hint="A link: X post, website or Telegram.">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={inputClass}
            placeholder="x.com/…"
          />
        </Field>

        {error ? <Notice kind="error">{error}</Notice> : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
