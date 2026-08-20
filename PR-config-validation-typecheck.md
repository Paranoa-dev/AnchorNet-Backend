# Fail-fast configuration validation + standalone `typecheck` script (#230)

Resolves **AnchorNet-Org/AnchorNet-Backend#230** (GrantFox OSS / Third Campaign).

## Summary

`package.json` had no standalone `typecheck` — types were only checked as a
side effect of `build`. More importantly, configuration failures degraded
silently: `src/middleware/apiKeyAuth.ts` makes the auth middleware a **no-op
(open access)** whenever `API_KEY` is unset, so a missing environment variable
changed the service's security posture instead of refusing to start.

This PR adds a fail-fast configuration contract (`validateConfig`) that runs at
startup **before the port binds**, a `typecheck` script wired into CI as a step
distinct from `build`, the full configuration inventory, and tests for the
required-value failure path.

## Configuration inventory

| Variable | Default | Required? | Absent behaviour |
| --- | --- | --- | --- |
| `PORT` | `3001` | optional | binds to `3001` |
| `FEE_BPS` | `10` | optional | 10 bps; validated `0–10000` |
| `API_KEY` | unset | **required in `production`**; optional in dev/test | dev/test: open access (historical). `production`: **refuses to start** naming `API_KEY` |
| `CORS_ORIGIN` | unset | optional | all origins permitted (historical default) |
| `BODY_LIMIT` | `"100kb"` | optional | 100kb JSON limit |
| `MAINTENANCE_MODE` | `false` | optional | writes allowed |
| `NODE_ENV` | `"development"` | optional | drives env-specific behaviour |
| `METRICS_SNAPSHOT_INTERVAL_MS` | unset | optional | no snapshots |
| `IDEMPOTENCY_TTL_MS` | `86_400_000` | optional | 24h window |
| `RATE_LIMIT_MAX` | `30` | optional | 30/window |
| `RATE_LIMIT_WINDOW_MS` | `60_000` | optional | 60s window |
| `TRUST_PROXY` | `false` | optional | proxy not trusted |

(Full reasoning in `docs/CONFIGURATION.md`.)

## Required-vs-optional classification

- **`API_KEY` → required in `production` only.** Its absence silently disables
  auth on every mutating endpoint — a security-relevant fail-open — so it must
  be present in production. In `development`/`test` the historical open access
  is preserved (no secret needed for local runs).
- **Everything else → optional** with a safe default; none alter a security
  control when absent. `FEE_BPS` is range-validated but still optional.

## Environment-sensitivity policy

Requirements are `NODE_ENV`-driven, never an unset variable: `production` ⇒
`API_KEY` mandatory; `development`/`test` ⇒ `API_KEY` optional. The mechanism
is explicit and centralised in `validateConfig`.

## Validation approach

**Hand-written checks in `src/config.ts` — no new dependency.** The service
ships exactly three runtime deps; a schema-validation library would be
unjustified for a twelve-value config that already has parsing helpers.
`validateConfig` is invoked from `loadConfig`, so it runs once at startup
before the server binds a port. Failures are actionable: the thrown
`ConfigValidationError` names the offending variable and explains the fix.

## Deliberate fail-open closure (called out)

The only behaviour change vs. the previous release: a `production` deployment
without `API_KEY` now **refuses to start** instead of running with open
mutating endpoints. No default was changed.

## Coordination with the `apiKeyAuth` issue

This issue owns the **general configuration contract** (fail fast on a missing
required value). The concrete authentication **policy** (when/how `API_KEY` is
enforced on routes) is owned by the separate `apiKeyAuth` issue.

## Evidence — fail-fast at startup

```text
$ NODE_ENV=production node dist/index.js
AnchorNet API failed to start: API_KEY is required when NODE_ENV=production.
Without it, mutating endpoints are open to unauthenticated access
(see src/middleware/apiKeyAuth.ts). Set API_KEY to a secret value, or run
with NODE_ENV=development for local open access.
$ echo $?
1

$ NODE_ENV=production API_KEY=secret node dist/index.js
AnchorNet API listening on http://localhost:3001   # starts normally
```

## What changed

- `src/config.ts` — added `validateConfig()` + `ConfigValidationError`; called
  from `loadConfig` so validation runs before the port binds.
- `src/index.ts` — wraps startup so an invalid configuration exits non-zero
  with a clear message before binding; keeps the default `app` export for
  tests.
- `src/config.test.ts` — added `validateConfig` tests: production-without-API_KEY
  throws (`ConfigValidationError`, names `API_KEY`), blank key treated as unset,
  dev/test allow missing key, production-with-key passes.
- `package.json` — added `"typecheck": "tsc --noEmit"`.
- `.github/workflows/ci.yml` — added a distinct **Type check** step (runs
  before `build`).
- `docs/CONFIGURATION.md` — full inventory, classification, and policy.

## Acceptance criteria (from #230)

- [x] PR contains the full configuration inventory with defaults and absent-value behaviour.
- [x] Each value is classified required/optional, with reasoning.
- [x] Missing required configuration causes a non-zero exit with a message naming the variable, before the port binds.
- [x] A test covers each required-value failure path.
- [x] A `typecheck` script exists and runs in CI as a separate step from `build`.
- [x] No default changed except the deliberate fail-open closure (called out).
- [x] `npm run lint`, `npm run typecheck`, `npm run build` and `npm test` all pass (494 tests, 42 suites).

## Verification

```bash
npm ci
npm run typecheck
npm run lint && npm run build && npm test
NODE_ENV=production node dist/index.js   # expect non-zero exit + clear message
NODE_ENV=production API_KEY=secret node dist/index.js   # expect it to listen
```

Closes #230.
