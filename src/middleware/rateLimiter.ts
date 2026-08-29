/**
 * In-memory rate limiter for mutating requests.
 *
 * Tracks request counts per client in a fixed rolling window and rejects
 * requests over the limit with 429. When API-key authentication is configured,
 * the authenticated `x-api-key` identifies the client; otherwise the client IP
 * is used. Read-only requests are always allowed. State lives in a plain `Map`
 * local to the returned middleware, so each `rateLimiter()` instance keeps its
 * own counters; this is a per-process safeguard and not suitable for
 * multi-instance deployments without a shared store.
 */

import { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors/ApiError";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Default number of mutating requests allowed per client per window. */
const DEFAULT_MAX = 30;
/** Default rolling window length, in milliseconds. */
const DEFAULT_WINDOW_MS = 60_000;

/** Maximum number of buckets tracked in memory to prevent unbounded growth. */
const MAX_BUCKETS = 5000;

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Maximum mutating requests allowed per client within the window. */
  max?: number;
  /** Length of the rolling window, in milliseconds. */
  windowMs?: number;
  /**
   * Paths to exclude from rate-limit accounting.  A request is skipped when
   * its path exactly matches an entry or starts with the entry followed by
   * "/".
   *
   * Path matching is relative to the mount point.  This works correctly
   * because the global limiter is mounted at the application root, where
   * `req.path` equals the full URL path.  Reuse on a sub-path mount would
   * require the exclusion list to account for the mount prefix.
   */
  skipPaths?: string[];
  /**
   * When `true`, this limiter also counts read (non-mutating) requests toward
   * the per-client budget. Defaults `false`, so the global limiter's
   * writes-only behaviour is unchanged.
   *
   * This flag is enabled only for the metrics mount, whose read endpoints
   * (notably `GET /history`) are otherwise unlimited. Extending read limiting
   * to every route — and the shared, multi-instance store that would require —
   * is deliberately left to the separate rate-limiter issue; this PR owns the
   * flag and its use for metrics only.
   */
  limitReads?: boolean;
}

export function rateLimiter(
  options: RateLimitOptions = {},
  configuredApiKey?: string,
) {
  const max = options.max ?? DEFAULT_MAX;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const buckets = new Map<string, Bucket>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!MUTATING_METHODS.has(req.method) && !options.limitReads) {
      next();
      return;
    }

    if (options.skipPaths) {
      const p = req.path;
      if (options.skipPaths.some((s) => p === s || p.startsWith(s + "/"))) {
        next();
        return;
      }
    }

    // The application installs apiKeyAuth before this middleware, so a header
    // is used only in deployments where API-key authentication is enabled.
    const requestApiKey = configuredApiKey
      ? req.header("x-api-key")
      : undefined;
    const key = requestApiKey
      ? `api-key:${requestApiKey}`
      : `ip:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= MAX_BUCKETS) {
        for (const [k, v] of buckets.entries()) {
          if (v.resetAt <= now) buckets.delete(k);
        }
        if (buckets.size >= MAX_BUCKETS) {
          const oldestKey = buckets.keys().next().value;
          if (oldestKey !== undefined) {
            buckets.delete(oldestKey);
          }
        }
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= max) {
      next(ApiError.tooManyRequests("rate limit exceeded, try again later"));
      return;
    }

    bucket.count += 1;
    next();
  };
}
