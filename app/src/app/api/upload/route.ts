/**
 * Uploads a narrative's image and metadata JSON, returning the URI that goes
 * into the mint's `TokenMetadata` extension.
 *
 * The JSON keys match what launchpads emit, because wallets and aggregators
 * parse for exactly those names — `image` is what renders the token's picture,
 * and anything unrecognised is ignored rather than merged.
 *
 * Storage is Vercel Blob: plain HTTPS URLs, which is what the metadata URI on
 * a real launchpad token points at. IPFS is not required, and a gateway that
 * goes down would take every token's image with it.
 */

import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** The off-chain document a wallet fetches from the mint's URI. */
type TokenMetadata = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  createdOn: string;
  website?: string;
  twitter?: string;
  telegram?: string;
};

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "narrative"
  );
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Uploads are not configured. Set BLOB_READ_WRITE_TOKEN — see app/.env.example.",
      },
      { status: 501 },
    );
  }

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
    // `addRandomSuffix` keeps two narratives with the same name from
    // overwriting each other's image.
    const uploadedImage = await put(`narrative-images/${base}`, image, {
      access: "public",
      addRandomSuffix: true,
      contentType: image.type,
    });

    const optional = (key: string): string | undefined => {
      const value = String(form.get(key) ?? "").trim();
      return value.length > 0 ? value : undefined;
    };

    const metadata: TokenMetadata = {
      name,
      symbol,
      description: String(form.get("description") ?? "").trim(),
      image: uploadedImage.url,
      createdOn: request.headers.get("origin") ?? "",
      website: optional("website"),
      twitter: optional("twitter"),
      telegram: optional("telegram"),
    };

    const uploadedJson = await put(
      `narrative-metadata/${base}.json`,
      JSON.stringify(metadata),
      {
        access: "public",
        addRandomSuffix: true,
        contentType: "application/json",
      },
    );

    return NextResponse.json({
      uri: uploadedJson.url,
      image: uploadedImage.url,
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Upload failed." },
      { status: 500 },
    );
  }
}
