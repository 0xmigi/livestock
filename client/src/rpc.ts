/**
 * An RPC client that survives a rate-limited node.
 *
 * Helius's free tier answers HTTP 429 as soon as a few requests land at
 * once, and its account index sometimes refuses `getProgramAccounts` with an
 * "overloaded, try again" internal error. Both are transient. This transport
 * spaces requests out so bursts (a page load, a create flow) stay under the
 * per-second cap, and retries the transient answers with backoff instead of
 * surfacing them to the user or failing a keeper pass.
 */

import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Rpc,
  type RpcTransport,
  type SolanaRpcApi,
} from "@solana/kit";

export type ThrottleOptions = {
  /** Requests allowed per second; the transport spaces calls to stay under it. Default 5. */
  requestsPerSecond?: number;
  /** How many times a transient failure is retried before it surfaces. Default 4. */
  retries?: number;
};

/** Whether a failure is the node's problem rather than the request's. */
function isTransient(error: unknown): boolean {
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const status = error.context.statusCode;
    return status === 429 || status >= 500;
  }
  if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR)) {
    return /overloaded|try again|timed? ?out|temporarily/i.test(error.context.__serverMessage ?? "");
  }
  // A dropped connection surfaces as a plain fetch failure.
  return error instanceof TypeError && /fetch|network|socket/i.test(error.message);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/** Wraps a transport with request spacing and retries. */
export function throttleTransport(base: RpcTransport, options: ThrottleOptions = {}): RpcTransport {
  const gap = 1000 / (options.requestsPerSecond ?? 5);
  const retries = options.retries ?? 4;
  // When the next request may go out. Every caller takes the next slot in line.
  let nextAt = 0;

  const transport: RpcTransport = async <TResponse>(config: Parameters<RpcTransport>[0]) => {
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const slot = Math.max(now, nextAt);
      nextAt = slot + gap;
      if (slot > now) await sleep(slot - now, config.signal);
      try {
        return await base<TResponse>(config);
      } catch (error) {
        if (attempt >= retries || !isTransient(error) || config.signal?.aborted) throw error;
        await sleep(400 * 2 ** attempt + Math.random() * 200, config.signal);
      }
    }
  };
  return transport;
}

/** A Solana RPC client over a throttled, retrying HTTP transport. */
export function createThrottledRpc(url: string, options?: ThrottleOptions): Rpc<SolanaRpcApi> {
  const transport = throttleTransport(createDefaultRpcTransport({ url }), options);
  return createSolanaRpcFromTransport(transport) as Rpc<SolanaRpcApi>;
}
