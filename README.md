anchornet-backend
AnchorNet API — routing, settlement, and liquidity indexer for the AnchorNet liquidity coordination network (Stellar anchors).

Overview
Stack: Node.js, Express, TypeScript
Role: REST API for routing, settlement engine, and liquidity analytics
Prerequisites
Node.js 18+
npm (or yarn/pnpm)
Setup
Bash

Clone the repo (or use your fork)
git clone <repo-url>
cd anchornet-backend

Install dependencies
npm install

Run in development
npm run dev
Server runs at http://localhost:3001 by default. Set PORT to override.

Scripts
Command Description
npm run dev Start dev server with hot reload
npm run build Compile TypeScript to dist/
npm start Run production build
npm test Run tests (Jest)
npm run lint Run ESLint
API
Service
GET /health – health check
GET /health/live – liveness probe, always 200 while the process is up
GET /health/ready – readiness probe, 200 normally and 503 once a
graceful shutdown has begun (so a load balancer stops routing new traffic)
GET /api/v1/info – API name and version
GET /api/v1/openapi.json – hand-maintained OpenAPI-shaped description of
every route below
GET /api/v1/audit – the most recent mutating requests (method, path,
status, request id, timestamp), last 200 in memory
Liquidity
POST /api/v1/liquidity – record liquidity { anchor, asset, amount }; repeated
contributions from the same anchor accumulate. Returns 201 with the entry.
POST /api/v1/liquidity/withdraw – withdraw liquidity { anchor, asset, amount }
previously recorded by an anchor, mirroring the on-chain contract's
withdraw_liquidity. Reduces the anchor's balance and removes the entry
once it reaches zero. Returns 404 if the anchor holds no balance in the
asset, or 400 (INSUFFICIENT_LIQUIDITY) if the amount exceeds it.
POST /api/v1/liquidity/transfer – atomically move liquidity
{ from, to, asset, amount } between two anchors for the same asset.
Decrements the source anchor and increments the destination anchor in a
single operation, so the pool total never dips mid-move (unlike a
withdraw followed by a separate add). Returns the updated entries for
both anchors as { from, to }. Returns 404 if the source anchor holds no
balance in the asset, 400 (INSUFFICIENT_LIQUIDITY) if the amount exceeds
the source balance — in which case neither balance changes — and 400 if
from and to are the same anchor.
GET /api/v1/liquidity – list aggregated pools { pools: [{ asset, total, anchors }] }
GET /api/v1/liquidity/entries – list raw per-anchor entries
GET /api/v1/liquidity/:asset – aggregated pool for one asset (404 if none)
Route ordering (liquidity): GET /:asset is a catch-all that matches any
single path segment, so every static single-segment liquidity GET
(/entries, /withdrawals) and /anchors/:anchor must stay registered before
it in src/routes/liquidity.ts. Express matches routes in registration
order; swapping them would silently make GET /api/v1/liquidity/entries
resolve as getPool("ENTRIES"). Regression tests in
src/routes/liquidity.test.ts pin this ordering.
DELETE /api/v1/liquidity/:anchor/:asset – administratively remove an
anchor's entire entry (404 if none). This bypasses reserved-liquidity
accounting checks, so operators should first confirm that no pending
settlements depend on the entry.
Routing
POST /api/v1/quote – compute a routing quote { asset, amount }. Selects
anchor liquidity largest-first and applies the protocol fee, returning
{ asset, amount, fee, deliverable, route }. When one anchor cannot cover
the full amount, additional anchors are added until the amount is covered.
Each entry in route contains { anchor, portion } — the anchor identifier
and the amount sourced from it. Returns 400 (INSUFFICIENT_LIQUIDITY) when
the combined pool cannot cover the amount.
Anchors
POST /api/v1/anchors – register an anchor { id, name? } (409 if it exists)
POST /api/v1/anchors/bulk – register a batch of anchors atomically
{ anchors: [{ id, name? }, ...] }; validates and checks every entry (against
both the existing registry and duplicates within the batch) before storing
any of them, so one bad entry never leaves a partial batch registered.
Supports ?dryRun=true for a read-only preflight check: the batch runs
through the identical validation and returns the same success/error
outcome (201 with the would-be-registered anchors, or the same 400/409),
but nothing is persisted. Successful responses include a dryRun boolean
so callers can confirm whether the batch was committed. The flag is
strictly parsed — only "true" or "false" (any casing) is accepted, and
any other value is a 400, so a typo can never silently perform a real
registration
GET /api/v1/anchors – list anchors; supports ?status=active or
?status=inactive (400 for any other value), a free-text ?q= search
over id/name (case-insensitive substring match), ?sort=id|name|registeredAt
with ?order=asc|desc (default asc), and ?format=csv to export the
(post-filter, post-sort) list as CSV instead of JSON
GET /api/v1/anchors/:id – read one anchor (404 if unknown)
PATCH /api/v1/anchors/:id – partially update an anchor's mutable name
(404 if unknown, 400 if name is missing or blank)
DELETE /api/v1/anchors/:id – deactivate an anchor
POST /api/v1/anchors/:id/reactivate – reactivate a previously deactivated
anchor (404 if unknown)
Anchor Settlements
GET /api/v1/anchors/:id/settlements – list settlements scoped to a specific
anchor (404 if the anchor id is unknown); supports the same
?sort=id|amount|fee|status|createdAt, ?order=asc|desc, ?page=,
?pageSize=, and ?format=csv params as GET /api/v1/settlements
Settlements
POST /api/v1/settlements – open a settlement { anchor, asset, amount },
reserving liquidity. Returns 201 with the pending settlement.
GET /api/v1/settlements – list settlements; supports ?anchor=, ?asset=,
?sort=id|amount|fee|status|createdAt with ?order=asc|desc (default
asc), ?page=, ?pageSize=, and ?format=csv (ignores pagination and
exports every matching, sorted row)
GET /api/v1/settlements/:id – read one settlement
POST /api/v1/settlements/:id/execute – execute a pending settlement
POST /api/v1/settlements/:id/cancel – cancel and release reserved
liquidity; accepts an optional { reason } recorded on the settlement
GET /api/v1/settlements/:id/audit – audit entries whose path references
this settlement id (method, path, status, request id, timestamp); returns
404 if the settlement id is unknown, empty array if it has no matching
entries (e.g. aged out of the ring buffer)
Metrics
GET /api/v1/metrics – aggregate counts (anchors, activeAnchors, pools,
totalLiquidity, settlements, pendingSettlements) plus settled-value totals:
totalSettledAmount (sum of settlement amount) and totalFeesCollected (sum
of settlement fee). Both value totals are computed from executed
settlements only — a pending settlement has merely reserved liquidity and
may still be cancelled, and a cancelled settlement never moved value, so
neither contributes. This lets an operator read total value settled and
total protocol fees earned without fetching every settlement and summing
client-side. Each read also appends a timestamped snapshot to an in-memory
rolling history (last 50 reads).
GET /api/v1/metrics/history – the recorded metrics snapshots, oldest first
({ snapshots: [...] }); each snapshot carries the same fields as
GET /api/v1/metrics plus an ISO-8601 timestamp. Retention is bounded to the
most recent 50 snapshots (MAX_HISTORY in src/routes/metrics.ts); older ones
are evicted, so the response can never grow without limit.

Metrics access (protected reads). Unlike the other read endpoints, the two
metrics endpoints expose aggregate operational intelligence — participant
counts, total liquidity, settlement volume and protocol fees earned, sampled
over time. That is useful to an operator and equally useful to someone
profiling the network before targeting it, so exposing it is treated as a
deliberate decision rather than a middleware side effect:

- When neither API_KEY nor METRICS_API_KEY is set, metrics reads are open
  (unchanged local/dev behaviour).
- When either key is set, GET /api/v1/metrics and GET /api/v1/metrics/history
  require a matching x-api-key header and return 401 otherwise.
- A monitoring scraper should be given METRICS_API_KEY — a read-only
  credential accepted for metrics but not for any mutating route — so
  monitoring keeps working without handing the write key to the scraper. The
  primary API_KEY is also accepted for metrics, so an operator already holding
  it needs nothing extra. Example scrape:
  `curl -H "x-api-key: $METRICS_API_KEY" http://localhost:3001/api/v1/metrics`
- Metrics reads (both endpoints) are rate-limited per client via
  METRICS_RATE_LIMIT_MAX (default 120/min), so the history endpoint cannot be
  used as a cheap load generator. This read-path limiting is scoped to the
  metrics mount and owned by this change; extending rate limiting to all reads
  and to a shared multi-instance store is tracked by the separate
  rate-limiter issue.
Errors use a uniform envelope: { "error": { "code", "message" } }, including
malformed JSON (400) and oversized request bodies (413,
PAYLOAD_TOO_LARGE). Every response carries an x-request-id header for
tracing, plus a small set of defensive security headers (X-Content-Type-Options,
X-Frame-Options, X-XSS-Protection, Referrer-Policy, X-DNS-Prefetch-Control).

Mutating requests (POST/PUT/PATCH/DELETE) are rate-limited per client.
The global limiter is mounted in `src/app.ts` for all mutating routes except
`/api/v1/quote`, using `DEFAULT_MAX = 30` and `DEFAULT_WINDOW_MS = 60_000`
from `src/middleware/rateLimiter.ts` unless overridden by configuration. When
`API_KEY` authentication is configured, the presented key identifies the
client; open deployments continue to use the client IP.

`POST /api/v1/quote` is excluded from the global limiter via `skipPaths` and
then receives its own stricter `rateLimiter({ max: 10, windowMs: 60_000 })`
instance in `src/app.ts`. That quote limiter has separate in-memory counters
from the global mutating-request limiter.

Requests over either limit receive `429` with code `RATE_LIMITED` and the
message `rate limit exceeded, try again later`. Clients should treat this as a
retryable response and back off before sending the next mutating request.

Mutating requests may also send an Idempotency-Key header. The first request
for a given key/method/path combination runs normally and its JSON response is
cached; any later request reusing the same key (within the configured TTL)
replays the original response instead of re-running the handler, so retried
requests don't double-apply side effects (e.g. registering the same anchor
twice). Reusing a key with a different body returns `422 IDEMPOTENCY_KEY_REUSE`.

Cache state is a process-wide in-memory store shared by every `idempotency()`
mount (hard-capped; default 1024 entries, soonest-expiry eviction). Concurrent
same-key requests share one in-flight execution. Multi-replica deployments still
need an external shared store once the persistence layer lands — this is the
same sequencing constraint as the rate limiter.

Only status + JSON body are stored for replay; response headers are never
cached.

Walkthrough Example
To verify how the idempotency system behaves, you can perform the following walkthrough using curl.

Initial request: Send a POST request to register an anchor with a unique Idempotency-Key header. The server processes this request normally and returns a 201 status code:

Bash

curl -i -X POST http://localhost:3001/api/v1/anchors
-H "Content-Type: application/json"
-H "Idempotency-Key: register-anchor-xyz"
-d '{"id": "anchor-xyz", "name": "Anchor XYZ"}'
Response:

http

HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
x-request-id: df743737-896c-4e4f-8dae-1c08a95302cd

{
"id": "anchor-xyz",
"name": "Anchor XYZ",
"registeredAt": "2026-07-22T14:17:57.537Z",
"active": true
}
Subsequent replay: Send the exact same request again using the same Idempotency-Key. The server returns the cached 201 response immediately, bypassing the normal handler and avoiding a 409 (which would normally happen for duplicate anchor registration):

Bash

curl -i -X POST http://localhost:3001/api/v1/anchors
-H "Content-Type: application/json"
-H "Idempotency-Key: register-anchor-xyz"
-d '{"id": "anchor-xyz", "name": "Anchor XYZ"}'
Response (Cached):

http

HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
x-request-id: 4a123f52-1623-429b-ba67-3d0d0d5c2eb0

{
"id": "anchor-xyz",
"name": "Anchor XYZ",
"registeredAt": "2026-07-22T14:17:57.537Z",
"active": true
}
Mismatched body: If you reuse the same Idempotency-Key but change the request
payload, the server returns `422` with code `IDEMPOTENCY_KEY_REUSE` instead of
replaying the original response.

Bash

curl -i -X POST http://localhost:3001/api/v1/anchors
-H "Content-Type: application/json"
-H "Idempotency-Key: register-anchor-xyz"
-d '{"id": "anchor-xyz", "name": "Anchor XYZ Modified Name"}'
Response:

http

HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json; charset=utf-8

{
"error": {
"code": "IDEMPOTENCY_KEY_REUSE",
"message": "Idempotency key already used with a different request body"
}
}
The process shuts down gracefully on SIGTERM/SIGINT: it stops accepting
new connections, closes the HTTP server, marks /health/ready unready, and
force-exits if it hasn't closed within 10 seconds.

Responses are gzip-compressed when the client sends Accept-Encoding: gzip
and the body is large enough to benefit.

When MAINTENANCE_MODE is enabled, every mutating request (POST/PUT/PATCH/DELETE)
is rejected with 503 (SERVICE_UNAVAILABLE) while reads keep working, so
operators can pause writes without taking the whole API down.

Configuration
The application is configured using environment variables. Every environment variable read by config.ts is listed below with its default and valid range/format:

Variable Default Valid Range / Format Description
PORT 3001 Positive integer (typically 1 - 65535) HTTP port the server binds to. Non-numeric values fall back to default.
FEE_BPS 10 Integer between 0 and 10000 (inclusive) Protocol fee in basis points applied to settlements and quotes. The process throws an error and fails to start if configured outside this range.
API_KEY (Unset) Any non-empty string If set, mutating requests (POST/PUT/PATCH/DELETE) must send an matching x-api-key header. Whitespace-only values are treated as unset. Also accepted for metrics reads.
METRICS_API_KEY (Unset) Any non-empty string Read-only credential for the metrics endpoints. If either this or API_KEY is set, GET /api/v1/metrics and /history require a matching x-api-key header. This key unlocks metrics only — it cannot authorize mutating requests — so a monitoring scraper can read metrics without the write key. Whitespace-only values are treated as unset.
METRICS_RATE_LIMIT_MAX 120 Positive integer Maximum metrics reads allowed per client within the metrics window. Covers reads (unlike the mutating-only global limiter) so the history endpoint is not an unlimited load generator.
METRICS_RATE_LIMIT_WINDOW_MS 60000 (1 min) Positive integer Length of the rolling window for the metrics read rate limit.
CORS_ORIGIN (Unset) Comma-separated list of origin URLs Allowed CORS origins. Whitespace around entries is trimmed; empty entries are ignored. If unset, every origin is permitted.
BODY_LIMIT 100kb Express bytes-compatible string (e.g., "500kb", "2mb") Maximum accepted JSON request body size. Default is applied if value is blank.
MAINTENANCE_MODE false "1", "true" (case-insensitive) to enable When enabled, mutating requests are rejected with a 503 Service Unavailable error, while read requests continue to function normally.
NODE_ENV development Any environment name string (e.g., "development", "production", "test") Specifies the runtime environment name.
METRICS_SNAPSHOT_INTERVAL_MS (Unset) Positive integer Optional interval in milliseconds to automatically take metrics snapshots.
IDEMPOTENCY_TTL_MS 86400000 (24h) Positive integer Milliseconds that a cached response remains eligible for idempotency replay.
RATE_LIMIT_MAX 30 Positive integer Maximum mutating requests allowed per client within the rolling rate-limiting window.
RATE_LIMIT_WINDOW_MS 60000 (1 min) Positive integer Length of the rolling rate-limiting window, in milliseconds.
Architecture
text

routes/ HTTP layer (thin controllers)
services/ business rules (liquidity, quotes, anchors, settlements)
repositories/ in-memory stores (swappable for an indexer)
middleware/ request id, logging, API-key auth, rate limiting, error handling
models/ domain types
config.ts env-based configuration
Contributing
Fork the repo and create a branch from main.
Install deps: npm install. Run tests: npm test; lint: npm run lint.
Open a pull request. CI runs lint, build, and tests on push/PR to main.
License
MIT