/**
 * Where narrative images and metadata JSON live.
 *
 * Vercel Blob when a token is set: plain HTTPS URLs, which is what the
 * metadata URI on a real launchpad token points at. Otherwise `app/.uploads/`
 * served by /api/uploads, so the app works locally and on devnet. Metadata is
 * written in place on edit, so a mint's URI never has to change.
 */

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { put } from "@vercel/blob";

/** Local uploads; gitignored. */
export const LOCAL_UPLOADS = path.join(process.cwd(), ".uploads");

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/** Only plain file names ever reach the disk. */
export const LOCAL_NAME = /^[a-z0-9-]+\.(png|jpg|webp|gif|json)$/;

/** The off-chain document a wallet fetches from the mint's URI. */
export type TokenMetadata = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  createdOn: string;
  website?: string;
  twitter?: string;
  telegram?: string;
};

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "narrative"
  );
}

function localUrl(request: Request, file: string): string {
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}/api/uploads/${file}`;
}

async function toBytes(body: Blob | string): Promise<Buffer> {
  return typeof body === "string" ? Buffer.from(body) : Buffer.from(await body.arrayBuffer());
}

/** Stores a new file under a unique name and returns its public URL. */
export async function store(
  request: Request,
  key: string,
  body: Blob | string,
  contentType: string,
): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // `addRandomSuffix` keeps two narratives with the same name from
    // overwriting each other's files.
    const uploaded = await put(key, body, { access: "public", addRandomSuffix: true, contentType });
    return uploaded.url;
  }
  if (process.env.VERCEL) {
    // The function's disk is read-only, and an ENOENT from mkdir says
    // nothing about the actual problem: the store is not connected.
    throw new Error(
      "Image storage is not set up: connect a Vercel Blob store so BLOB_READ_WRITE_TOKEN is set.",
    );
  }
  const ext = path.extname(key);
  const file = `${path.basename(key, ext)}-${randomBytes(4).toString("hex")}${ext}`;
  await mkdir(LOCAL_UPLOADS, { recursive: true });
  await writeFile(path.join(LOCAL_UPLOADS, file), await toBytes(body));
  return localUrl(request, file);
}

/**
 * Rewrites the file behind a URL this app issued, keeping the URL. Refuses
 * anything hosted elsewhere: it is not ours to change.
 */
export async function overwrite(url: string, body: Blob | string, contentType: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.pathname.startsWith("/api/uploads/")) {
    const file = parsed.pathname.slice("/api/uploads/".length);
    if (!LOCAL_NAME.test(file)) throw new Error("Not a file this app serves.");
    await mkdir(LOCAL_UPLOADS, { recursive: true });
    await writeFile(path.join(LOCAL_UPLOADS, file), await toBytes(body));
    return;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN && parsed.hostname.endsWith(".blob.vercel-storage.com")) {
    const pathname = decodeURIComponent(parsed.pathname.slice(1));
    await put(pathname, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      // The CDN would otherwise hold an edit back for a while.
      cacheControlMaxAge: 60,
    });
    return;
  }

  throw new Error("This narrative's metadata is not hosted by this app, so it cannot be edited here.");
}
