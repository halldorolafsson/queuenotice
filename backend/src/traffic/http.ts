import { config } from "../config.js";

export class HttpError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: "GET" | "POST";
  body?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryable(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

/**
 * GET/POST med tidsavbrudd og gjenforsøk ved nettverksfeil, 429 og 5xx.
 * Venter 1 s, deretter 3 s (eller Retry-After, maks 10 s).
 */
export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastError: HttpError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let retryAfterMs: number | null = null;
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? config.HTTP_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as T;
      const header = res.headers.get("retry-after");
      if (header && /^\d+$/.test(header)) retryAfterMs = Math.min(Number(header) * 1000, 10000);
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      lastError = new HttpError(`HTTP ${res.status} fra ${new URL(url).host}${detail ? `: ${detail}` : ""}`, res.status);
    } catch (err) {
      const name = (err as Error).name;
      const reason = name === "TimeoutError" ? "tidsavbrudd" : (err as Error).message;
      lastError = new HttpError(`Nettverksfeil mot ${new URL(url).host}: ${reason}`, null);
    }
    if (!retryable(lastError.status) || attempt === retries) break;
    await sleep(retryAfterMs ?? (attempt === 0 ? 1000 : 3000));
  }
  throw lastError ?? new HttpError("Ukjent feil", null);
}
