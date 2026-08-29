/**
 * AnchorNet API application factory.
 *
 * Builds and configures the Express app without binding to a port so that the
 * same instance can be reused by the HTTP server and by tests.
 */

import express, { Express, Request, Response } from "express";
import cors from "cors";
import compression from "compression";

import { LiquidityRepository } from "./repositories/liquidityRepository";
import { AnchorRepository } from "./repositories/anchorRepository";
import { SettlementRepository } from "./repositories/settlementRepository";
import { LiquidityService } from "./services/liquidityService";
import { QuoteService } from "./services/quoteService";
import { AnchorService } from "./services/anchorService";
import { SettlementService } from "./services/settlementService";
import { liquidityRouter } from "./routes/liquidity";
import { quoteRouter } from "./routes/quote";
import { anchorRouter } from "./routes/anchors";
import { settlementRouter } from "./routes/settlements";
import { metricsRouter } from "./routes/metrics";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { requestId } from "./middleware/requestId";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { metricsAuth } from "./middleware/metricsAuth";
import { rateLimiter } from "./middleware/rateLimiter";
import { securityHeaders } from "./middleware/securityHeaders";
import { idempotency } from "./middleware/idempotency";
import { maintenanceMode } from "./middleware/maintenanceMode";
import { createAuditLog } from "./middleware/auditLog";
import { loadConfig, Config } from "./config";
import { buildOpenApiSpec } from "./openapi";
import { isReady } from "./utils/readiness";

export function createApp(): Express {
  const app = express();
  const config = loadConfig();
  app.set('trust proxy', 1); // Ensure req.ip reflects real client IP behind reverse proxy (#120)

  app.set("trust proxy", config.trustProxy);

  app.use(cors(config.corsOrigins ? { origin: config.corsOrigins } : undefined));
  app.use(compression());
  app.use(securityHeaders);
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(requestId);
  app.use(requestLogger);
  app.use(maintenanceMode(config.maintenanceMode));
  app.use(apiKeyAuth(config.apiKey));
  app.use(rateLimiter({ max: config.rateLimitMax, windowMs: config.rateLimitWindowMs, skipPaths: ["/api/v1/quote"] }, config.apiKey));
  app.use(idempotency({ ttlMs: config.idempotencyTtlMs }));

  const audit = createAuditLog();
  app.use(audit.middleware);

  const repo = new LiquidityRepository();
  const anchors = new AnchorService(new AnchorRepository());
  const quotes = new QuoteService(repo, config.feeBps);
  const settlements = new SettlementService(
    new SettlementRepository(),
    repo,
    anchors,
    config.feeBps,
  );
  const liquidity = new LiquidityService(repo, settlements);

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "anchornet-backend" });
  });

  app.get("/health/live", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/health/ready", (_req: Request, res: Response) => {
    if (!isReady()) {
      res.status(503).json({ status: "not_ready" });
      return;
    }
    res.json({ status: "ready" });
  });

  app.get("/api/v1/info", (_req: Request, res: Response) => {
    res.json({
      name: "AnchorNet API",
      version: "0.9.0",
      description: "Liquidity coordination network for Stellar anchors",
    });
  });

  app.get("/api/v1/openapi.json", (_req: Request, res: Response) => {
    res.json(buildOpenApiSpec());
  });

  app.get("/api/v1/audit", (_req: Request, res: Response) => {
    res.json({ entries: audit.entries(), evictedCount: audit.evictedCount() });
  });

  app.use("/api/v1/liquidity", liquidityRouter(liquidity));
  // Quote requests are excluded from the global rate limiter and subject
  // only to this stricter 10 req/min limit.  The global limiter still
  // applies to all other mutating routes.
  //
  // NOTE: This is the recommended interpretation — each endpoint should
  // enforce its own limit independently.  The tradeoff is that a client
  // doing 10 quote POSTs/min + 30 other mutating requests/min would total
  // 40 mutating requests/min, exceeding the global limiter's 30/min budget.
  // If total-backend-write-volume capping is desired instead, remove
  // skipPaths and document the dual-limiter intent explicitly.
  app.use(
    "/api/v1/quote",
    rateLimiter({ max: 10, windowMs: 60_000 }, config.apiKey),
  );
  app.use("/api/v1/quote", quoteRouter(quotes));
  app.use("/api/v1/anchors", anchorRouter(anchors, settlements));
  app.use("/api/v1/settlements", settlementRouter(settlements, audit.entries));
  // Metrics expose aggregate operational data (participant counts, liquidity
  // totals, settlement volume and fees over time). That is deliberately
  // treated as protected rather than public: reads require authentication
  // whenever a key is configured, and — unlike the global writes-only limiter
  // — are rate-limited via `limitReads` so the unauthenticated-or-not history
  // endpoint cannot be used as a cheap load generator. When no key is set the
  // guard is a no-op, preserving open access for local/dev deployments.
  app.use(
    "/api/v1/metrics",
    metricsAuth(config.apiKey, config.metricsApiKey),
    rateLimiter(
      {
        max: config.metricsRateLimitMax,
        windowMs: config.metricsRateLimitWindowMs,
        limitReads: true,
      },
      config.apiKey ?? config.metricsApiKey,
    ),
    metricsRouter({
      liquidity,
      anchors,
      settlements,
      snapshotIntervalMs: config.metricsSnapshotIntervalMs,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Expose the validated configuration for external consumers.
 */
export function getConfig(): Config {
  return loadConfig();
}
