# AnchorNet Backend — Configuration Contract

This document is the configuration inventory required by
[AnchorNet-Org/AnchorNet-Backend#230](https://github.com/AnchorNet-Org/AnchorNet-Backend/issues/230).
It lists every configuration value, its default, what happens when it is
absent, and whether it is **required** or **optional**. The fail-fast
validation itself lives in `src/config.ts` (`validateConfig`).

## Inventory

| Variable | Default | Required? | Behaviour when absent |
| --- | --- | --- | --- |
| `PORT` | `3001` | optional | Server binds to `3001`. |
| `FEE_BPS` | `10` | optional | 10 bps protocol fee; validated to `0–10000` (throws if out of range). |
| `API_KEY` | unset | **required in `production`**; optional in `development`/`test` | `development`/`test`: middleware is a no-op (open access — historical behaviour). `production`: **deployment refuses to start** with a clear error naming `API_KEY`. |
| `CORS_ORIGIN` | unset | optional | No allowlist → every origin permitted (historical default). Comma-separated, HTTP(S)-only, origin-only (rejects paths/queries/credentials). |
| `BODY_LIMIT` | `"100kb"` | optional | JSON body size limit of `100kb`. |
| `MAINTENANCE_MODE` | `false` | optional | Mutating requests allowed; `"1"`/`"true"` enables 503-on-write. |
| `NODE_ENV` | `"development"` | optional | Drives environment-specific behaviour (see `API_KEY`). |
| `METRICS_SNAPSHOT_INTERVAL_MS` | unset | optional | No automatic metrics snapshots. |
| `IDEMPOTENCY_TTL_MS` | `86_400_000` | optional | 24h replay/eligibility window. |
| `RATE_LIMIT_MAX` | `30` | optional | 30 mutating requests per window. |
| `RATE_LIMIT_WINDOW_MS` | `60_000` | optional | 60s rolling window. |
| `TRUST_PROXY` | `false` | optional | `X-Forwarded-For` not trusted. |

## Required vs optional classification

**Rule:** a value is *required* only when its absence changes a **security**
behaviour. Everything else keeps its historical default and stays optional, so
existing correct deployments are unaffected.

- **`API_KEY` → required in `production`.** `src/middleware/apiKeyAuth.ts`
  makes the middleware a no-op (open access) whenever `apiKey` is unset. That
  is a security-relevant fail-open: an unset variable silently disables
  authentication on every mutating endpoint. In `production` that is
  unacceptable, so a missing `API_KEY` fails the startup contract. In
  `development`/`test` the historical open access is preserved so local runs
  need no secret.
- **All other values → optional.** Each has a safe default and none of them
  alter a security control when absent; `FEE_BPS` is further range-validated
  but still optional.

## Environment sensitivity

Requirements are `NODE_ENV`-driven, never an unset variable:

- `NODE_ENV=production` ⇒ `API_KEY` is mandatory.
- `NODE_ENV=development` or `test` ⇒ `API_KEY` is optional (open access).

This mechanism is explicit and centralised in `validateConfig`; there is no
hidden opt-out flag.

## Validation approach

**Hand-written checks in `src/config.ts`** (no new dependency). The service
ships exactly three runtime dependencies (`express`, `cors`, `compression`);
adding a schema-validation library would need justification it does not earn
for a twelve-value config with already-present parsing helpers. `validateConfig`
is called from `loadConfig` (and therefore from `createApp()`/`getConfig()`),
so it runs once at startup, **before the server binds a port**. Failures are
actionable: the thrown `ConfigValidationError` names the offending variable
(e.g. `API_KEY`) and explains the expected value and the fix.

## Deliberate fail-open closure

The only behaviour change versus the previous release is that a `production`
deployment without `API_KEY` now **refuses to start** instead of running with
open mutating endpoints. This is the issue's core intent and is called out
here. No default was changed.

## Coordination with the `apiKeyAuth` issue

This issue owns the **general configuration contract** (fail fast if a required
value is missing). The concrete authentication **policy** — when and how
`API_KEY` is enforced on routes — is owned by the separate `apiKeyAuth` issue.
Here we only guarantee the deployment visibly refuses to start rather than
silently running unauthenticated.
