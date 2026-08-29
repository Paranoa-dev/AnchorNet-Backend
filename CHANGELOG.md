Changelog
All notable changes to the AnchorNet API are documented here.

[Unreleased]
Added
Security: the metrics endpoints (GET /api/v1/metrics and
/api/v1/metrics/history) are now protected reads. When API_KEY or the new
METRICS_API_KEY is configured they require a matching x-api-key header
(401 otherwise); when neither is set they stay open, matching the existing
write-auth model. METRICS_API_KEY is a read-only credential that unlocks
metrics but not mutating routes, so a monitoring scraper needs no write
key. Metrics reads are now rate-limited per client (METRICS_RATE_LIMIT_MAX,
default 120/min) via a new opt-in limitReads flag on the rate limiter, so
the history endpoint cannot be used as an unlimited load generator.
Snapshot-history retention remains bounded to the most recent 50 entries,
now pinned by a route-level test. src/openapi.ts declares an ApiKeyAuth
security scheme and marks both metrics operations as protected. The
read-limiting is scoped to the metrics mount; global read limiting and a
shared multi-instance store remain owned by the separate rate-limiter issue.
Metrics: GET /api/v1/metrics now reports totalSettledAmount (sum of
settlement amount) and totalFeesCollected (sum of settlement fee),
computed from executed settlements only — pending settlements have
merely reserved liquidity and may still be cancelled, and cancelled ones
never moved value, so neither contributes. Operators can now read total
value settled and total protocol fees earned without fetching every
settlement and summing client-side. The fields are purely additive: the
existing anchors, activeAnchors, pools, totalLiquidity,
settlements and pendingSettlements fields are unchanged, and the same
totals appear in GET /api/v1/metrics/history snapshots.
[0.9.0]
Added
Operations: GET /api/v1/audit — the most recent mutating requests
(method, path, status, request id, timestamp), kept in a bounded in-memory
buffer (last 200), backed by a new createAuditLog middleware.
Fixed
The audit log initially read req.path lazily inside the response
finish handler, which could capture the mount-relative path left behind
by Express's sub-router dispatch instead of the full request path; it now
snapshots the method/path synchronously before calling next().
[0.8.0]
Added
Anchors: ?q= free-text search (case-insensitive substring over
id/name) and ?format=csv export on GET /api/v1/anchors.
Settlements: optional { reason } on POST /api/v1/settlements/:id/cancel,
recorded as cancelReason; ?format=csv export on GET /api/v1/settlements
(ignores pagination, exports every matching sorted row).
Rate limiting: POST /api/v1/quote now has an additional, stricter
limit (10/minute) on top of the general per-client default.
Utilities: toCsv minimal CSV serialization helper.
[0.7.0]
Added
Health: GET /health/live (liveness) and GET /health/ready
(readiness) probes, backed by a new process-wide readiness tracker. The
process now marks itself not-ready as soon as a graceful shutdown begins.
Performance: gzip response compression for clients that accept it.
Operations: MAINTENANCE_MODE config flag — when enabled, mutating
requests are rejected with 503 (SERVICE_UNAVAILABLE) while reads keep
working.
Anchors: POST /api/v1/anchors/bulk to atomically register a batch of
anchors; the whole batch is validated (including duplicates within the
batch) before any of it is stored.
Errors: ApiError.serviceUnavailable (503) helper.
[0.6.0]
Added
Middleware: Idempotency-Key header support for mutating requests —
the first request for a given key/method/path runs normally and its
response is cached; a retried request reusing the same key (within 24h)
replays the original response instead of re-running the handler.
Anchors: PATCH /api/v1/anchors/:id to partially update an anchor's
mutable name (404 if unknown, 400 if name is missing or blank).
Metrics: GET /api/v1/metrics/history, a rolling in-memory history of
the last 50 metrics snapshots (oldest first), backed by a new generic
BoundedHistory buffer utility. Each read of GET /api/v1/metrics records
a new snapshot.
Utilities: requirePositiveInteger validation helper, now shared by
the settlement id parsing that previously duplicated the same check.
Changed
Docs: 
openapi.ts
 now documents the anchor patch and metrics
history endpoints.
[0.5.0]
Added
Service: GET /api/v1/openapi.json, a hand-maintained OpenAPI-shaped
description of every route.
Middleware: hand-rolled security headers (X-Content-Type-Options,
X-Frame-Options, X-XSS-Protection, Referrer-Policy,
X-DNS-Prefetch-Control) applied to every response.
Configuration: CORS_ORIGIN to restrict cross-origin requests to a
comma-separated allowlist (unset keeps the previous permissive default);
BODY_LIMIT to cap accepted JSON request body size (default 100kb).
Process: graceful shutdown on SIGTERM/SIGINT — stops accepting new
connections, closes the HTTP server, and force-exits after a 10s timeout.
Changed
Configuration: FEE_BPS is now validated at startup; the process fails
fast if it falls outside 0-10000.
Fixed
Errors: malformed JSON and oversized request bodies now return the
standard error envelope (400/413) instead of a generic 500.
[0.4.0]
Added
Anchors: POST /api/v1/anchors/:id/reactivate to reverse a
deactivation without re-registering the anchor.
Settlements: ?asset= filter on GET /api/v1/settlements, composable
with the existing ?anchor= filter.
Sorting: ?sort=/?order= on GET /api/v1/anchors (id, name,
registeredAt) and GET /api/v1/settlements (id, amount, fee,
status, createdAt), backed by a new generic applySort utility.
[0.3.0]
Added
Liquidity: POST /api/v1/liquidity/withdraw to withdraw previously
recorded liquidity, mirroring the on-chain contract's withdraw_liquidity.
Reduces an anchor's balance and removes the entry once it reaches zero.
Anchors: ?status=active / ?status=inactive filter on
GET /api/v1/anchors.
Middleware: in-memory rate limiting for mutating requests (default 30
requests/minute per client IP), returning 429 (RATE_LIMITED) when
exceeded.
Errors: a tooManyRequests (429) helper on ApiError.
[0.2.0]
Added
Anchors: registry endpoints (/api/v1/anchors) with register, list, read
and deactivate, backed by an anchor service and repository.
Settlements: /api/v1/settlements to open, execute, cancel, list (with
?anchor= filter and pagination) and read settlements. Liquidity is reserved
on open, released on cancel, and consumed on execute.
Metrics: /api/v1/metrics aggregate view of anchors, pools, liquidity and
settlements.
Configuration: env-based loadConfig (PORT, FEE_BPS, API_KEY,
NODE_ENV).
Middleware: request-id tracing and optional API-key auth for mutating
requests.
Utilities: offset-based pagination helper.
Changed
Extracted the Express app into a factory and switched lint to the
TypeScript-aware no-unused-vars rule.
[0.1.0]
Added
Initial Express API: health/info endpoints, liquidity recording and pool
aggregation, and a largest-first routing quote endpoint.