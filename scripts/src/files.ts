/**
 * The file store: narrative images and metadata JSON, on a Railway volume.
 *
 * A plain HTTP server with two verbs. The app PUTs a file with the shared
 * secret; anyone can GET it. Files live under FILES_DIR (a Railway volume,
 * e.g. /data) so they survive deploys. This runs inside the keeper's
 * process, so one Railway service does both jobs.
 *
 *   FILES_SECRET=... FILES_DIR=/data PORT=8080 pnpm --filter @nm/scripts run files
 *
 * The app sets FILES_URL to this service's public domain and FILES_SECRET to
 * the same secret (see app/src/lib/server/storage.ts).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Only plain file names ever touch the disk. */
const NAME = /^[a-z0-9-]+\.(png|jpg|webp|gif|json)$/;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  json: "application/json",
};

/** Images are named with a random suffix and never change; JSON is edited in place. */
const CACHE: Record<string, string> = {
  json: "public, max-age=60",
};
const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

const MAX_BYTES = 5 * 1024 * 1024;

function nameOf(url: string | undefined): string | null {
  const match = /^\/files\/([^/?#]+)$/.exec(url ?? "");
  if (!match) return null;
  const name = decodeURIComponent(match[1]);
  return NAME.test(name) ? name : null;
}

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error("Too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

export function startFileServer(): void {
  const secret = process.env.FILES_SECRET;
  if (!secret) return;
  const dir = process.env.FILES_DIR ?? join(process.cwd(), "files");
  const port = Number(process.env.PORT ?? 8080);

  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/health") return reply(res, 200, "ok");

      const name = nameOf(req.url);
      if (!name) return reply(res, 404, "Not found.");
      const ext = name.slice(name.lastIndexOf(".") + 1);
      const path = join(dir, name);

      if (req.method === "GET" || req.method === "HEAD") {
        let info;
        try {
          info = await stat(path);
        } catch {
          return reply(res, 404, "Not found.");
        }
        res.writeHead(200, {
          "content-type": TYPES[ext],
          "content-length": info.size,
          "cache-control": CACHE[ext] ?? CACHE_IMMUTABLE,
          "access-control-allow-origin": "*",
        });
        if (req.method === "HEAD") return res.end();
        return res.end(await readFile(path));
      }

      if (req.method === "PUT") {
        if (req.headers.authorization !== `Bearer ${secret}`) return reply(res, 401, "Unauthorized.");
        const bytes = await body(req);
        if (bytes.length === 0) return reply(res, 400, "Empty.");
        await mkdir(dir, { recursive: true });
        // Write beside, then rename: a reader never sees a half-written file.
        const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, bytes);
        await rename(tmp, path);
        return reply(res, 200, "ok");
      }

      reply(res, 405, "Method not allowed.");
    } catch (cause) {
      reply(res, 500, cause instanceof Error ? cause.message : "Failed.");
    }
  });

  server.listen(port, () => {
    console.log(`files on :${port}, stored in ${dir}`);
  });
}

// Run on its own when invoked directly (local testing).
if (process.argv[1]?.endsWith("files.ts")) {
  if (!process.env.FILES_SECRET) {
    console.error("FILES_SECRET is required.");
    process.exit(1);
  }
  startFileServer();
}
