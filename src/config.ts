/**
 * Typed application configuration loaded from environment variables.
 */

import { URL } from "node:url";

export interface Config {
  /** Port the HTTP server binds to. */
  port: number;
  /** Protocol fee in basis points applied to settlements/quotes. */
  feeBps: number;
  /** Optional API key required for mutating requests (disabled if unset). */
  apiKey?: string;
  /**
   * Optional read-only credential that grants access to the metrics endpoints
   * (`GET /api/v1/metrics` and `/history`) without granting the write access
   * carried by {@link apiKey}. Lets a monitoring scraper read operational
   * metrics with a credential that cannot mutate the network. Whitespace-only
   * values are treated as unset.
   */
  metricsApiKey?: string;
  /**
   * Allowed CORS origins. `undefined` means no allowlist is configured and
   * every origin is permitted (the historical default behavior).
   */
  corsOrigins?: string[];
  /** Maximum accepted JSON request body size, as an `express.json` `limit` string. */
  bodyLimit: string;
  /** When `true`, mutating requests are rejected with 503 while reads still work. */
  maintenanceMode: boolean;
  /** Current environment name. */
  env: string;
  /** Optional interval in milliseconds to automatically take metrics snapshots. */
  metricsSnapshotIntervalMs?: number;
  /** Milliseconds a cached response remains eligible for replay. */
  idempotencyTtlMs: number;
  /** Maximum mutating requests allowed per client within the window. */
  rateLimitMax: number;
  /** Length of the rolling window, in milliseconds. */
  rateLimitWindowMs: number;
  /**
   * Maximum metrics **reads** allowed per client within the metrics window.
   * Unlike {@link rateLimitMax}, this budget covers the read-only metrics
   * endpoints, which are otherwise unlimited. Defaults higher than the
   * mutating limit so a polling scraper is not throttled.
   */
  metricsRateLimitMax: number;
  /** Length of the metrics read rate-limiting window, in milliseconds. */
  metricsRateLimitWindowMs: number;
  /**
   * Express `trust proxy` setting. When enabled behind a load balancer,
   * Express trusts the `X-Forwarded-For` header so `req.ip` reflects the
   * real client address rather than the proxy's IP.
   */
  trustProxy: boolean | string | number;
}

const DEFAULT_BODY_LIMIT = "100kb";

function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parses a comma-separated `CORS_ORIGIN` value into a list of allowed
 * origins, trimming whitespace and dropping empty entries. Only HTTP(S)
 * origins are accepted; paths, credentials, queries, and fragments are
 * rejected so configuration mistakes fail visibly at startup. Returns
 * `undefined` when unset or when every entry is blank.
 */
function parseCorsOrigins(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        `CORS_ORIGIN contains an invalid origin: ${JSON.stringify(origin)}`,
      );
    }

    const isHttpOrigin =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    const hasOriginOnly =
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "";

    if (!isHttpOrigin || !hasOriginOnly) {
      throw new Error(
        `CORS_ORIGIN contains an invalid origin: ${JSON.stringify(origin)}`,
      );
    }
  }

  return origins.length > 0 ? origins : undefined;
}

const MIN_FEE_BPS = 0;
const MAX_FEE_BPS = 10_000;

/** Parses a `MAINTENANCE_MODE` env value as a boolean; `"1"`/`"true"` (case-insensitive) enable it. */
function parseBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.trim().toLowerCase() === "1" || value.trim().toLowerCase() === "true";
}

/**
 * Parses `TRUST_PROXY` into an Express-compatible value.
 *
 * - `"true"` / `"1"` → `true`
 * - `"false"` / `"0"` / unset → `false`
 * - numeric string → `number`
 * - anything else → passed through as a `string` (e.g. `"loopback"`)
 */
function parseTrustProxy(value: string | undefined): boolean | string | number {
  if (value === undefined) return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  const num = Number(trimmed);
  if (Number.isFinite(num) && trimmed !== "") return num;
  return trimmed;
}

/**
 * Error thrown when a required configuration value is missing or invalid.
 * Carries the offending variable name so the message can name it directly
 * (see {@link validateConfig}).
 */
export class ConfigValidationError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(message);
    this.name = "ConfigValidationError";
    this.variable = variable;
  }
}

/**
 * Fail-fast configuration contract.
 *
 * Runs once at startup (invoked from {@link loadConfig}, before the server
 * binds a port) and refuses to start when a *required* value is absent.
 *
 * Required vs optional policy (full inventory in the PR / docs/CONFIGURATION.md):
 *   - Every value keeps its historical default and remains OPTIONAL *except*
 *     `API_KEY`, whose absence silently disables authentication on every
 *     mutating endpoint (see `src/middleware/apiKeyAuth.ts`). That is a
 *     security-relevant fail-open behaviour, so `API_KEY` is REQUIRED when
 *     `NODE_ENV === "production"`. In development/test the historical open
 *     access is preserved so local runs need no secret.
 *   - This issue owns the *general configuration contract*; the concrete
 *     authentication *policy* (when/how the key is enforced) is owned by the
 *     separate `apiKeyAuth` issue. Here we only guarantee the deployment
 *     visibly refuses to start instead of silently running unauthenticated.
 */
export function validateConfig(config: Config): Config {
  if (config.env === "production" && !config.apiKey) {
    throw new ConfigValidationError(
      "API_KEY",
      "API_KEY is required when NODE_ENV=production. Without it, mutating " +
        "endpoints are open to unauthenticated access (see src/middleware/apiKeyAuth.ts). " +
        "Set API_KEY to a secret value, or run with NODE_ENV=development for local open access.",
    );
  }
  return config;
}

/** Builds the {@link Config} from `process.env`, applying sensible defaults. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const apiKey = env.API_KEY?.trim();
  const metricsApiKey = env.METRICS_API_KEY?.trim();
  const feeBps = intFromEnv(env.FEE_BPS, 10);

  if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) {
    throw new Error(
      `FEE_BPS must be between ${MIN_FEE_BPS} and ${MAX_FEE_BPS} (got ${feeBps})`,
    );
  }

  const config: Config = {
    port: intFromEnv(env.PORT, 3001),
    feeBps,
    apiKey: apiKey ? apiKey : undefined,
    metricsApiKey: metricsApiKey ? metricsApiKey : undefined,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN),
    bodyLimit: env.BODY_LIMIT?.trim() || DEFAULT_BODY_LIMIT,
    maintenanceMode: parseBooleanFlag(env.MAINTENANCE_MODE),
    env: env.NODE_ENV ?? "development",
    metricsSnapshotIntervalMs: env.METRICS_SNAPSHOT_INTERVAL_MS
      ? parseInt(env.METRICS_SNAPSHOT_INTERVAL_MS, 10)
      : undefined,
    idempotencyTtlMs: intFromEnv(env.IDEMPOTENCY_TTL_MS, 86_400_000),
    rateLimitMax: intFromEnv(env.RATE_LIMIT_MAX, 30),
    rateLimitWindowMs: intFromEnv(env.RATE_LIMIT_WINDOW_MS, 60_000),
    metricsRateLimitMax: intFromEnv(env.METRICS_RATE_LIMIT_MAX, 120),
    metricsRateLimitWindowMs: intFromEnv(env.METRICS_RATE_LIMIT_WINDOW_MS, 60_000),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  };

  return validateConfig(config);
}

/**
 * Startup configuration contract.
 *
 * `loadConfig` applies safe defaults so the service can boot in development;
 * `validateConfig` enforces the *required* values and fails fast (throws) before
 * the server binds a port. Required vs optional is intentionally conservative:
 * only values whose absence changes a security posture or makes the server
 * undeliverable are required.
 *
 * Decisions (see PR for full inventory):
 *  - `API_KEY` is REQUIRED when `NODE_ENV=production`. Without it the API-key
 *    middleware degrades to a no-op (open mutating access). We refuse to start
 *    in that insecure state instead of silently downgrading security. In every
 *    other environment an unset key is allowed but logged loudly as open access.
 *    The auth *policy* itself stays owned by `apiKeyAuth`; this only owns the
 *    configuration contract.
 *  - `PORT` must be a valid TCP port (1–65535); an invalid port makes the server
 *    undeliverable, so it is required to be valid.
 *  - `RATE_LIMIT_MAX` and `IDEMPOTENCY_TTL_MS` must be non-negative.
 * All other values have safe defaults and never fail startup on their own.
 *
 * Validation is hand-written on purpose: it avoids adding a runtime schema
 * dependency (keeping the project's lean 3-dependency footprint) and keeps the
 * contract easy to review.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function validateConfig(config: Config): Config {
  if (config.env === "production" && !config.apiKey) {
    throw new ConfigValidationError(
      "API_KEY is required when NODE_ENV=production. Refusing to start with open (unauthenticated) mutating access. Set API_KEY to enable API-key authentication.",
    );
  }

  if (
    typeof config.port !== "number" ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  ) {
    throw new ConfigValidationError(
      `PORT must be an integer between 1 and 65535 (got ${String(config.port)})`,
    );
  }

  if (config.rateLimitMax < 0) {
    throw new ConfigValidationError(
      `RATE_LIMIT_MAX must be >= 0 (got ${config.rateLimitMax})`,
    );
  }

  if (config.idempotencyTtlMs < 0) {
    throw new ConfigValidationError(
      `IDEMPOTENCY_TTL_MS must be >= 0 (got ${config.idempotencyTtlMs})`,
    );
  }

  if (!config.apiKey && config.env !== "test") {
    // Loud, actionable warning: the service is running with open mutating access.
    console.warn(
      "[config] WARNING: API_KEY is not set — mutating requests are open to everyone (no authentication). " +
        "Set API_KEY (or run in development) to avoid open access.",
    );
  }

  return config;
}
