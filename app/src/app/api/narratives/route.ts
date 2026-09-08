/**
 * Every narrative, scanned once on the server and shared by every visitor.
 *
 * The scan is a `getProgramAccounts` call plus a metadata fetch per
 * narrative: too much to run in each browser, and it would put the RPC key
 * in the page. So it runs here, with the server's own key, and the result
 * is held for a short while. Bigints travel as `{ "$big": "..." }`.
 */

import { NextResponse } from "next/server";

import { stringifyBig } from "@/lib/json-big";
import { decorateNarratives, scanNarratives, type ScannedNarrative } from "@/lib/scan";
import { rpc } from "@/lib/server/rpc";

/** How long one scan serves everyone. */
const TTL_MS = 15_000;
/** How long a narrative's metadata is trusted before it is fetched again. */
const META_MAX_AGE_MS = 5 * 60_000;

let cached: { at: number; body: string } | null = null;
let inflight: Promise<string> | null = null;

async function scan(): Promise<string> {
  const bare = await scanNarratives(rpc);
  const rows: ScannedNarrative[] = await decorateNarratives(rpc, bare, META_MAX_AGE_MS);
  return stringifyBig({ narratives: rows, scannedAt: Date.now() });
}

export async function GET() {
  const now = Date.now();
  try {
    if (!cached || now - cached.at > TTL_MS) {
      // One scan at a time: a burst of visitors shares the same promise.
      inflight ??= scan().finally(() => {
        inflight = null;
      });
      cached = { at: now, body: await inflight };
    }
    return new NextResponse(cached.body, {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, s-maxage=${Math.floor(TTL_MS / 1000)}, stale-while-revalidate=60`,
      },
    });
  } catch (cause) {
    // A stale list beats an empty page.
    if (cached) return new NextResponse(cached.body, { headers: { "content-type": "application/json" } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 502 });
  }
}
