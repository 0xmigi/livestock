/**
 * Uploads a narrative's image and metadata JSON, returning the URI that goes
 * into the mint's `TokenMetadata` extension.
 *
 * The JSON keys match what launchpads emit, because wallets and aggregators
 * parse for exactly those names — `image` is what renders the token's picture,
 * and anything unrecognised is ignored rather than merged.
 *
 * Storage is the file store beside the keeper on Railway (see
 * src/lib/server/storage.ts): plain HTTPS URLs, which is what the metadata
 * URI on a real launchpad token points at. Without it (local development)
 * files land in `app/.uploads/` and are served back by /api/uploads, so
 * creating works anywhere the app runs. Those URIs only resolve while this
 * server is up.
 */

import { NextResponse } from "next/server";
import { address } from "@solana/kit";

import { BIO_MAX_CHARS } from "@/lib/config";
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  slug,
  store,
  type TokenMetadata,
} from "@/lib/server/storage";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected form data." }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  const symbol = String(form.get("symbol") ?? "").trim();
  if (!name || !symbol) {
    return NextResponse.json(
      { error: "Name and ticker are required." },
      { status: 400 },
    );
  }
  // The mint the document is for. Only that mint's creator may rewrite it
  // later (see /api/narrative/[mint]); the URI on a mint proves nothing.
  let mint: string;
  try {
    mint = address(String(form.get("mint") ?? ""));
  } catch {
    return NextResponse.json({ error: "The mint address is required." }, { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "An image is required." }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(image.type)) {
    return NextResponse.json(
      { error: "Image must be PNG, JPEG, WebP or GIF." },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Image must be 4MB or smaller." },
      { status: 400 },
    );
  }

  const base = slug(name);

  try {
    const imageUrl = await store(
      request,
      `narrative-images/${base}${IMAGE_EXTENSIONS[image.type] ?? ""}`,
      image,
      image.type,
    );

    const optional = (key: string): string | undefined => {
      const value = String(form.get(key) ?? "").trim();
      return value.length > 0 ? value : undefined;
    };

    const metadata: TokenMetadata = {
      mint,
      name,
      symbol,
      description: String(form.get("description") ?? "").trim().slice(0, BIO_MAX_CHARS),
      image: imageUrl,
      createdOn: request.headers.get("origin") ?? "",
      website: optional("website"),
      twitter: optional("twitter"),
      telegram: optional("telegram"),
    };

    const uri = await store(
      request,
      `narrative-metadata/${base}.json`,
      JSON.stringify(metadata),
      "application/json",
    );

    return NextResponse.json({ uri, image: imageUrl });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Upload failed." },
      { status: 500 },
    );
  }
}
