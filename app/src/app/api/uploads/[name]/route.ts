/**
 * Serves files stored locally by /api/upload when no Blob token is set.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { LOCAL_NAME, LOCAL_UPLOADS } from "@/lib/server/storage";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
};

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  // Only plain file names: nothing that could climb out of the directory.
  if (!LOCAL_NAME.test(name)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const bytes = await readFile(path.join(LOCAL_UPLOADS, name));
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": TYPES[path.extname(name)] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}
