/**
 * Static, hand-maintained OpenAPI-shaped description of the AnchorNet API
 * surface, served at `GET /api/v1/openapi.json`.
 *
 * This is not generated from the routers, so it must be kept in sync as
 * endpoints are added or changed. It intentionally favors a short, readable
 * summary per operation over a fully-typed OpenAPI document with schemas.
 */

const PKG_VERSION = "0.9.0";

export function buildOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "AnchorNet API",
      version: PKG_VERSION,
      description: "Liquidity coordination network for Stellar anchors. \n\n**[BREAKING CHANGE]** All monetary values (amounts, balances, portions, totals, fees) are now strictly represented in stroops and serialized as strings in JSON to prevent IEEE-754 precision loss.",
    },
    paths: {
      "/health": {
        get: { summary: "Health check" },
      },
      "/health/live": {
        get: { summary: "Liveness probe (always 200 while the process is up)" },
      },
      "/health/ready": {
        get: {
          summary: "Readiness probe (503 once graceful shutdown has begun)",
        },
      },
      "/api/v1/info": {
        get: { summary: "API name and version" },
      },
      "/api/v1/audit": {
        get: {
          summary:
            "Recent mutating requests (method, path, status, request id, timestamp)",
        },
      },
      "/api/v1/liquidity": {
        post: {
          summary: "Record (or accumulate) liquidity for an anchor/asset pair",
        },
        get: {
          summary: "List aggregated liquidity pools",
          description:
            "Returns an array of Pool objects, each containing asset, total, anchors count, and a lastUpdated timestamp.",
        },
      },
      "/api/v1/liquidity/withdraw": {
        post: { summary: "Withdraw previously recorded liquidity" },
      },
      "/api/v1/liquidity/transfer": {
        post: {
          summary:
            "Atomically transfer liquidity between two anchors for the same asset. " +
            "Decrements the source anchor and increments the destination anchor in a " +
            "single operation, so the pool total never changes mid-transfer. Returns " +
            "400 (INSUFFICIENT_LIQUIDITY) without changing any balance when the source " +
            "anchor cannot cover the amount.",
        },
      },
      "/api/v1/liquidity/entries": {
        get: {
          summary: "List raw per-anchor liquidity entries",
          description:
            "Returns { entries: [...] }. This static path is registered before the " +
            "catch-all GET /api/v1/liquidity/{asset}; that ordering is load-bearing, " +
            "since reversing it would make this path resolve as a pool lookup for an " +
            'asset named "ENTRIES".',
        },
      },

      "/api/v1/liquidity/withdrawals": {
        get: {
          summary: "Recent successful liquidity withdrawals, oldest first",
          description:
            "Read-only audit trail of withdrawals recorded by POST /api/v1/liquidity/withdraw. " +
            "Each entry records the anchor, asset, amount withdrawn, the anchor's resulting " +
            "balance, and an ISO-8601 timestamp, and persists even after an entry is removed " +
            "once its balance reaches zero. Bounded to the most recent records.",
        },
      },
      "/api/v1/liquidity/anchors/{anchor}": {
        get: { summary: "List raw liquidity entries for a single anchor" },
      },
      "/api/v1/liquidity/{asset}": {
        get: {
          summary: "Read the aggregated pool for one asset",
          description:
            "Returns a single Pool object containing asset, total, anchors count, and a lastUpdated timestamp.",
        },
      },
      "/api/v1/liquidity/{anchor}/{asset}": {
        delete: {
          summary: "Remove an anchor's entire liquidity entry for an asset",
          description:
            "Administrative operation that bypasses reserved-liquidity accounting checks. " +
            "Confirm that no pending settlements depend on the entry before removing it.",
        },
      },
      "/api/v1/quote": {
        post: {
          summary:
            "Compute a largest-first routing quote. When one anchor cannot cover the full amount, " +
            "additional anchors are added until the amount is covered. Each route entry includes the " +
            "anchor and the portion it supplies.",
          description: "**[BREAKING CHANGE]** Request `amount` and response fields (`amount`, `fee`, `deliverable`, `portion`) are now serialized as strings representing stroops.",
        },
      },
      "/api/v1/anchors": {
        post: { summary: "Register an anchor" },
        get: {
          summary: "List anchors",
          parameters: ["status", "q", "sort", "order", "format"],
        },
      },
      "/api/v1/anchors/{id}": {
        get: { summary: "Read one anchor" },
        patch: {
          summary: "Partially update an anchor's name",
          description:
            "Strict body: `name` is the only accepted field. Any other key " +
            "(e.g. `active`, `id`, or a typo like `enabled`) is rejected with " +
            "a 400 naming the offending field, rather than being silently " +
            "ignored. A missing or blank `name` is also a 400.",
        },
        delete: { summary: "Deactivate an anchor" },
      },
      "/api/v1/anchors/{id}/reactivate": {
        post: { summary: "Reactivate a previously deactivated anchor" },
      },
      "/api/v1/anchors/bulk": {
        post: {
          summary: "Register a batch of anchors atomically",
          description:
            "Validates every entry (against both the existing registry and " +
            "duplicate ids within the batch) before storing any of them. " +
            "Pass ?dryRun=true to run that identical validation as a " +
            "read-only preflight check: the response reports the same " +
            "success/error outcome and the would-be-registered anchors, but " +
            'nothing is persisted. `dryRun` accepts only "true" or ' +
            '"false"; any other value is a 400.',
          parameters: ["dryRun"],
        },
      },
      "/api/v1/anchors/{id}/settlements": {
        get: {
          summary: "List settlements scoped to a specific anchor",
          description:
            "Returns the same paginated settlement list as GET /api/v1/settlements?anchor={id}, " +
            "but scoped to the anchor identified by :id. Returns 404 if the anchor does not exist.",
          parameters: ["sort", "order", "page", "pageSize", "format"],
        },
      },
      "/api/v1/settlements": {
        post: { summary: "Open a settlement, reserving liquidity" },
        get: {
          summary: "List settlements",
          parameters: [
            "anchor",
            "asset",
            "sort",
            "order",
            "page",
            "pageSize",
            "format",
          ],
        },
      },
      "/api/v1/settlements/{id}": {
        get: { summary: "Read one settlement" },
      },
      "/api/v1/settlements/{id}/execute": {
        post: { summary: "Execute a pending settlement" },
      },
      "/api/v1/settlements/{id}/cancel": {
        post: {
          summary: "Cancel a pending settlement and release its liquidity",
        },
      },
      "/api/v1/settlements/{id}/audit": {
        get: {
          summary:
            "Audit entries whose path references this settlement id",
          description:
            "Returns audit entries (method, path, status, request id, timestamp) whose path " +
            "contains the given settlement id. Reuses the in-memory audit store from the " +
            "global GET /api/v1/audit, filtered locally. Returns 404 if the settlement id " +
            "does not exist, and an empty array if it exists but has no matching entries " +
            "(e.g. entries aged out of the ring buffer).",
        },
      },
      "/api/v1/metrics": {
        get: {
          summary: "Aggregate network metrics",
          description:
            "Returns anchors, activeAnchors, pools, totalLiquidity, settlements and " +
            "pendingSettlements, plus totalSettledAmount (sum of settlement amount) and " +
            "totalFeesCollected (sum of settlement fee). Both value totals are computed " +
            "from executed settlements only — pending settlements have merely reserved " +
            "liquidity and cancelled ones never moved value, so neither contributes. " +
            "Each read also appends a timestamped snapshot to the rolling history.",
        },
      },
      "/api/v1/metrics/history": {
        get: {
          summary: "Recent aggregate metrics snapshots, oldest first",
          description:
            "Returns { snapshots: [...] }, where each snapshot carries the same fields as " +
            "GET /api/v1/metrics (including totalSettledAmount and totalFeesCollected) " +
            "plus an ISO-8601 timestamp.",
        },
      },
    },
  };
}
