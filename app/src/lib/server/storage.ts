/**
 * Where narrative images and metadata JSON live.
 *
 * In production, the file store that runs alongside the keeper on Railway
 * (scripts/src/files.ts): `FILES_URL` is its public domain and
 * `FILES_SECRET` the shared secret it accepts uploads with. Files land on a
 * Railway volume and are served straight back as plain HTTPS URLs, which is
 * what the metadata URI on a real launchpad token points at.
 *
 * Without those two variables (local development) files land in
 * `app/.uploads/` and are served by /api/uploads. Metadata is written in
 * place on edit, so a mint's URI never has to change.
 */

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FILES_URL = process.env.FILES_URL?.replace(/\/+$/, "");
const FILES_SECRET = process.env.FILES_SECRET;

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
  /**
   * The mint this document belongs to. Written at upload and checked before
   * any edit: a mint's URI is whatever its creator chose, so the URI alone
   * cannot say which narrative may rewrite the file behind it.
   */
  mint?: string;
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
  // The random suffix keeps two narratives with the same name from
  // overwriting each other's files.
  const ext = path.extname(key);
  const file = `${path.basename(key, ext)}-${randomBytes(4).toString("hex")}${ext}`;

  if (FILES_URL && FILES_SECRET) {
    await putFile(file, body, contentType);
    return `${FILES_URL}/files/${file}`;
  }
  if (process.env.VERCEL) {
    // The function's disk is read-only, and an ENOENT from mkdir says
    // nothing about the actual problem: the file store is not configured.
    throw new Error("Image storage is not set up: set FILES_URL and FILES_SECRET to the Railway file store.");
  }
  await mkdir(LOCAL_UPLOADS, { recursive: true });
  await writeFile(path.join(LOCAL_UPLOADS, file), await toBytes(body));
  return localUrl(request, file);
}

/** One PUT to the file store. It answers 200 or explains why not. */
async function putFile(file: string, body: Blob | string, contentType: string): Promise<void> {
  const response = await fetch(`${FILES_URL}/files/${file}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${FILES_SECRET}`, "content-type": contentType },
    body,
  });
  if (!response.ok) {
    throw new Error(`The file store refused the upload (${response.status}): ${await response.text()}`);
  }
}

/** A JSON body may only replace a .json file, an image only an image. */
function sameKind(file: string, contentType: string): boolean {
  const isJson = file.endsWith(".json");
  return isJson === (contentType === "application/json");
}

/**
 * Rewrites the file behind a URL this app issued, keeping the URL. Refuses
 * anything hosted elsewhere: it is not ours to change. Callers must have
 * already established that the file belongs to whoever is asking.
 */
export async function overwrite(url: string, body: Blob | string, contentType: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.pathname.startsWith("/api/uploads/")) {
    const file = parsed.pathname.slice("/api/uploads/".length);
    if (!LOCAL_NAME.test(file) || !sameKind(file, contentType)) throw new Error("Not a file this app serves.");
    await mkdir(LOCAL_UPLOADS, { recursive: true });
    await writeFile(path.join(LOCAL_UPLOADS, file), await toBytes(body));
    return;
  }

  if (FILES_URL && FILES_SECRET && url.startsWith(`${FILES_URL}/files/`)) {
    const file = url.slice(`${FILES_URL}/files/`.length);
    if (!LOCAL_NAME.test(file) || !sameKind(file, contentType)) throw new Error("Not a file this app serves.");
    await putFile(file, body, contentType);
    return;
  }

  throw new Error("This narrative's metadata is not hosted by this app, so it cannot be edited here.");
}
