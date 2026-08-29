/**
 * Read authentication for the metrics endpoints.
 *
 * The aggregate metrics served by `GET /api/v1/metrics` and
 * `GET /api/v1/metrics/history` — anchor and participant counts, total
 * liquidity, settlement volume and protocol fees earned, sampled over time —
 * describe the operational state of the network. That is business
 * intelligence: valuable to an operator, and equally valuable to someone
 * profiling the network before targeting it. Exposing it publicly should be a
 * deliberate decision, not a side effect of the write-only `apiKeyAuth`. This
 * middleware makes metrics reads authenticated by default.
 *
 * A request is authorized when it presents an `x-api-key` header matching
 * **either**:
 *   - the primary {@link apiKey} (the same credential that authorizes writes),
 *     so an operator already holding it needs nothing new; or
 *   - a dedicated, read-only {@link metricsApiKey}, so a monitoring scraper can
 *     read metrics with a credential that cannot mutate the network.
 *
 * When neither key is configured the middleware is a no-op (open access),
 * matching the "locked only once a key is set" model of `apiKeyAuth` and
 * preserving the historical behaviour for local development and deliberately
 * open deployments.
 */

import { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors/ApiError";

/**
 * Builds the metrics read-authentication middleware.
 *
 * @param apiKey        Primary API key, if configured. Accepted for metrics
 *                      reads so operators reuse a single credential.
 * @param metricsApiKey Dedicated read-only metrics key, if configured.
 */
export function metricsAuth(apiKey?: string, metricsApiKey?: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // No credential configured anywhere: metrics remain openly readable.
    if (!apiKey && !metricsApiKey) {
      next();
      return;
    }

    const presented = req.header("x-api-key");
    const matchesPrimary = apiKey !== undefined && presented === apiKey;
    const matchesMetrics =
      metricsApiKey !== undefined && presented === metricsApiKey;

    if (matchesPrimary || matchesMetrics) {
      next();
      return;
    }

    next(ApiError.unauthorized("missing or invalid API key"));
  };
}
