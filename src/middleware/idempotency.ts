/**
 * Idempotency-key support for mutating requests.
 *
 * Clients may send an `Idempotency-Key` header on POST/PUT/PATCH/DELETE
 * requests. The first request for a given key/method/path combination runs
 * normally and its JSON response is cached; any later request reusing the
 * same key within the TTL replays the cached response instead of re-running
 * the handler, so retrying a request that already took effect (or already
 * failed) doesn't double-apply side effects. Requests without the header are
 * unaffected.
 *
 * Cache state lives in a process-wide {@link IdempotencyStore} shared by every
 * `idempotency()` mount that does not inject its own `store` option. That
 * closes the cross-mount duplicate hole inside one process. True multi-replica
 * deployments still need an external shared store — this service has no
 * persistence layer yet, so we keep an in-process store with a hard entry cap
 * and leave Redis/DB to the separate persistence issue.
 *
 * Concurrent same-key requests share a single in-flight promise so only one
 * handler runs; waiters replay (or 422 on body mismatch) when it completes.
 *
 * A SHA-256 fingerprint of the canonical JSON request body is stored alongside
 * the cached response. On key reuse, if the incoming body hash differs, a 422
 * `IDEMPOTENCY_KEY_REUSE` error is returned instead of replaying the cached
 * response. Canonical serialization uses stable key ordering so that
 * semantically identical bodies with different key orderings are treated as
 * the same request.
 *
 * Only `status` + JSON body are stored — response headers are never cached
 * (so no `Set-Cookie` / auth leakage via the replay path).
 */

import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors/ApiError";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Default time a cached response remains eligible for replay. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Default hard cap on cached entries (expired entries are purged first). */
export const DEFAULT_MAX_ENTRIES = 1024;

/**
 * Produce a deterministic JSON string for any value. Object keys are sorted
 * recursively so that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` serialize to the
 * same string. Array element order is preserved (order is semantically
 * meaningful in arrays). Primitives and null pass through to JSON.stringify.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (k) =>
        JSON.stringify(k) +
        ":" +
        stableStringify((value as Record<string, unknown>)[k]),
    );
  return "{" + sorted.join(",") + "}";
}

/**
 * SHA-256 hex digest of the canonicalized request body. `undefined` (no body)
 * hashes the empty string; an explicit `{}` hashes `"{}"`. This distinction
 * is deliberate: the two are different wire representations.
 */
function hashBody(body: unknown): string {
  const raw = body !== undefined ? stableStringify(body) : "";
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export interface CachedResponse {
  status: number;
  body: unknown;
  expiresAt: number;
  bodyHash: string;
}

export type InflightClaim =
  | { status: "hit"; entry: CachedResponse }
  | { status: "wait"; promise: Promise<CachedResponse> }
  | {
      status: "run";
      complete: (entry: CachedResponse) => void;
      fail: (err: unknown) => void;
    };

export interface IdempotencyStore {
  get(key: string, now?: number): CachedResponse | undefined;
  set(key: string, entry: CachedResponse): void;
  /** Number of live (non-expired) entries — used by tests. */
  size(now?: number): number;
  /**
   * Atomically: return a cache hit, join an in-flight execution, or claim the
   * right to run the handler for this key.
   */
  begin(key: string, now?: number): InflightClaim;
  /** Drop all entries and in-flight waiters (tests). */
  clear(): void;
}

/**
 * Bounded in-memory store. Evicts expired entries on write; if still over
 * `maxEntries`, drops the soonest-to-expire live entries until under the cap.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, CachedResponse>();
  private readonly inflight = new Map<string, Promise<CachedResponse>>();
  readonly maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
    this.maxEntries = maxEntries;
  }

  get(key: string, now: number = Date.now()): CachedResponse | undefined {
    const cached = this.entries.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return cached;
  }

  set(key: string, entry: CachedResponse): void {
    const now = Date.now();
    this.purgeExpired(now);
    this.entries.set(key, entry);
    this.enforceBound();
  }

  size(now: number = Date.now()): number {
    this.purgeExpired(now);
    return this.entries.size;
  }

  begin(key: string, now: number = Date.now()): InflightClaim {
    const cached = this.get(key, now);
    if (cached) return { status: "hit", entry: cached };

    const pending = this.inflight.get(key);
    if (pending) return { status: "wait", promise: pending };

    let resolveEntry!: (entry: CachedResponse) => void;
    let rejectEntry!: (err: unknown) => void;
    const promise = new Promise<CachedResponse>((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });
    promise.catch(() => undefined);
    this.inflight.set(key, promise);

    return {
      status: "run",
      complete: (entry: CachedResponse) => {
        this.inflight.delete(key);
        this.set(key, entry);
        resolveEntry(entry);
      },
      fail: (err: unknown) => {
        this.inflight.delete(key);
        rejectEntry(err);
      },
    };
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  private purgeExpired(now: number): void {
    for (const [k, v] of this.entries) {
      if (v.expiresAt <= now) this.entries.delete(k);
    }
  }

  private enforceBound(): void {
    if (this.entries.size <= this.maxEntries) return;
    const ranked = [...this.entries.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt,
    );
    let overflow = this.entries.size - this.maxEntries;
    for (const [k] of ranked) {
      if (overflow <= 0) break;
      this.entries.delete(k);
      overflow -= 1;
    }
  }
}

/** Process-wide default so every `idempotency()` mount shares one cache. */
const defaultStore = new MemoryIdempotencyStore();

export interface IdempotencyOptions {
  /** Milliseconds a cached response remains eligible for replay. */
  ttlMs?: number;
  /**
   * Hard cap on cached entries when using the process-wide default store.
   * Ignored when a custom `store` is passed — configure that store instead.
   * Changing this after the default store was constructed has no effect;
   * prefer injecting `new MemoryIdempotencyStore(n)` for a private cap.
   */
  maxEntries?: number;
  /**
   * Override the process-wide store (tests / multi-mount sharing). When
   * omitted, all middleware instances share the same default store.
   */
  store?: IdempotencyStore;
}

function resolveStore(options: IdempotencyOptions): IdempotencyStore {
  if (options.store) return options.store;
  return defaultStore;
}

function replay(res: Response, cached: CachedResponse): void {
  res.status(cached.status).json(cached.body);
}

export function idempotency(options: IdempotencyOptions = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const store = resolveStore(options);

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.header("idempotency-key");
    if (!key || !MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }

    const cacheKey = `${req.method} ${req.originalUrl} ${key}`;
    const bodyHash = hashBody(req.body);

    void (async () => {
      try {
        const claim = store.begin(cacheKey);

        if (claim.status === "hit" || claim.status === "wait") {
          try {
            const finished =
              claim.status === "hit" ? claim.entry : await claim.promise;
            if (finished.bodyHash !== bodyHash) {
              next(
                ApiError.idempotencyKeyReuse(
                  "Idempotency key already used with a different request body",
                ),
              );
              return;
            }
            replay(res, finished);
          } catch (err) {
            next(err);
          }
          return;
        }

        const { complete, fail } = claim;
        const originalJson = res.json.bind(res);
        let settled = false;

        res.json = ((body: unknown) => {
          if (!settled) {
            settled = true;
            complete({
              status: res.statusCode,
              body,
              expiresAt: Date.now() + ttlMs,
              bodyHash,
            });
          }
          return originalJson(body);
        }) as Response["json"];

        res.on("close", () => {
          if (!settled && !res.writableEnded) {
            settled = true;
            fail(new Error("client closed before response"));
          }
        });

        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}

/** Exposed for tests that need to wipe process-wide state between cases. */
export function resetDefaultIdempotencyStore(): void {
  defaultStore.clear();
}
