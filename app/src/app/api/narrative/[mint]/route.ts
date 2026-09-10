/**
 * Edits a narrative's off-chain metadata: image, description, links.
 *
 * Name, symbol, stock, date and curve are on chain and fixed. The JSON the
 * mint's URI points at is not, and this app hosts it, so the creator can
 * rewrite it in place. Proof of who is asking is a signed message from the
 * creator's wallet; no transaction, no fee.
 *
 * The URI is whatever the creator put on their mint, so it cannot decide
 * which file they may rewrite: anyone could point a mint of their own at
 * another narrative's file. The file decides. Every document this app
 * uploads names its mint, and only that mint's creator may replace it.
 */

import { NextResponse } from "next/server";
import { decodeNarrative, findNarrative } from "@nm/client";
import { fetchMaybeMint } from "@solana-program/token-2022";
import {
  address,
  getBase64Encoder,
  getPublicKeyFromAddress,
  getUtf8Encoder,
  unwrapOption,
  verifySignature,
  type SignatureBytes,
} from "@solana/kit";

import { BIO_MAX_CHARS } from "@/lib/config";
import { rpc } from "@/lib/server/rpc";
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  overwrite,
  slug,
  store,
  type TokenMetadata,
} from "@/lib/server/storage";

/** How old a signed request may be. */
const MAX_AGE_MS = 5 * 60_000;

/** What the wallet signs. The browser builds the same string. */
function editMessage(mint: string, issuedAt: number): string {
  return `Livestock\nUpdate narrative ${mint}\nAt ${issuedAt}`;
}

export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  try {
    const { mint: rawMint } = await context.params;
    const mint = address(rawMint);

    const form = await request.formData();
    const owner = address(String(form.get("owner") ?? ""));
    const issuedAt = Number(form.get("issuedAt"));
    const signature = String(form.get("signature") ?? "");
    if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > MAX_AGE_MS) {
      return NextResponse.json({ error: "That request is stale. Try again." }, { status: 400 });
    }

    // 1. The signature is the creator's.
    const key = await getPublicKeyFromAddress(owner);
    const ok = await verifySignature(
      key,
      new Uint8Array(getBase64Encoder().encode(signature)) as SignatureBytes,
      getUtf8Encoder().encode(editMessage(mint, issuedAt)),
    );
    if (!ok) return NextResponse.json({ error: "Bad signature." }, { status: 401 });

    // 2. The signer created this narrative.
    const [narrativeAddress] = await findNarrative(mint);
    const { value: account } = await rpc.getAccountInfo(narrativeAddress, { encoding: "base64" }).send();
    if (!account) return NextResponse.json({ error: "Narrative not found." }, { status: 404 });
    const narrative = decodeNarrative(Uint8Array.from(Buffer.from(account.data[0], "base64")));
    if (narrative.creator !== owner) {
      return NextResponse.json({ error: "Only the creator can edit this narrative." }, { status: 403 });
    }

    // 3. Its metadata lives at the URI on the mint.
    const mintAccount = await fetchMaybeMint(rpc, mint);
    const extensions = mintAccount.exists ? (unwrapOption(mintAccount.data.extensions) ?? []) : [];
    const meta = extensions.find((e) => e.__kind === "TokenMetadata");
    const uri = meta && meta.__kind === "TokenMetadata" ? meta.uri : null;
    if (!uri) return NextResponse.json({ error: "This mint carries no metadata." }, { status: 400 });

    const current = (await fetch(uri, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))) as Partial<TokenMetadata>;

    // 4. The file belongs to this mint. A document without a mint predates
    //    this check and cannot be told apart from someone else's, so it
    //    stays as it is.
    if (current.mint !== mint) {
      return NextResponse.json(
        {
          error: current.mint
            ? "That metadata file belongs to a different narrative."
            : "This narrative's metadata was created before edits were bound to the mint, so it cannot be edited here.",
        },
        { status: 403 },
      );
    }

    // 5. Apply the edit.
    let image = current.image ?? "";
    const upload = form.get("image");
    if (upload instanceof File && upload.size > 0) {
      if (!ALLOWED_IMAGE_TYPES.includes(upload.type)) {
        return NextResponse.json({ error: "Image must be PNG, JPEG, WebP or GIF." }, { status: 400 });
      }
      if (upload.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Image must be 4MB or smaller." }, { status: 400 });
      }
      image = await store(
        request,
        `narrative-images/${slug(narrative.name)}${IMAGE_EXTENSIONS[upload.type] ?? ""}`,
        upload,
        upload.type,
      );
    }

    const text = (name: string): string | undefined => {
      const value = form.get(name);
      if (value === null) return undefined; // not sent: keep what is there
      const trimmed = String(value).trim();
      return trimmed;
    };
    const link = (name: keyof TokenMetadata): string | undefined => {
      const sent = text(name);
      const value = sent === undefined ? current[name] : sent;
      return typeof value === "string" && value.length > 0 ? value : undefined;
    };

    const next: TokenMetadata = {
      mint,
      name: narrative.name,
      symbol: narrative.symbol,
      description: (text("description") ?? current.description ?? "").slice(0, BIO_MAX_CHARS),
      image,
      createdOn: current.createdOn ?? "",
      website: link("website"),
      twitter: link("twitter"),
      telegram: link("telegram"),
    };

    await overwrite(uri, JSON.stringify(next), "application/json");
    return NextResponse.json({ uri, image });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
