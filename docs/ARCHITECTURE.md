AnchorNet Backend Architecture & Security Guarantees
Overview
The anchornet-backend service provides REST APIs for Stellar liquidity coordination, settlement, and routing.

Security Architecture & Audit Log Guarantees
Audit Endpoint (GET /api/v1/audit)
The audit log middleware (src/middleware/auditLog.ts) captures recent mutating requests (POST, PUT, PATCH, DELETE) in an in-memory bounded ring buffer.

Captured Fields
method: HTTP method
path: Request path (without query parameters)
status: Response status code
requestId: Correlation ID from x-request-id response header
timestamp: ISO timestamp of request completion
Sensitive Data Redaction & Security Guarantees
Strict Redaction via Denylist: Any header, body parameter, or metadata stored in audit log entries is processed through redactSensitiveData().
Denylisted Fields: Secret-bearing keys such as x-api-key, authorization, cookie, set-cookie, token, access_token, refresh_token, secret, password, bearer, private_key, client_secret are matched case-insensitively and replaced with "[REDACTED]".
Preventing Plaintext Exposure: Under no circumstances should raw credentials or API keys be captured or retained in plaintext in the in-memory audit ring buffer or exposed via GET /api/v1/audit.
In-Memory Repositories & Future Persistence
Settlement, anchor, and liquidity data are held in process-local in-memory
repositories (src/repositories/*), all extending the shared
InMemoryRepository base class.

Idempotency cache (src/middleware/idempotency.ts) follows the same sequencing:
a process-wide `MemoryIdempotencyStore` (shared across mounts, hard-capped,
in-flight coalescing) closes within-process holes without introducing Redis/DB.
Cross-replica idempotency is intentionally deferred to the persistence-layer
issue — once that store exists, swap the default `IdempotencyStore`
implementation rather than bolting on a second persistence stack here.

Persistence-Swap Risk (read before swapping any repository for a DB)
Several repositories already document that they are "swappable for a
persistent … store later" (e.g. liquidityRepository.ts). This is a forward
design intent, but the current id-allocation contract does not survive that
swap unchanged:

InMemoryRepository.generateId() / peekId() allocate ids under the
assumption that they run synchronously and atomically on Node's single
thread. peekId() exposes the id that generateId() will hand out next
without any locking.
SettlementRepository.peekNextId() returns that previewed id. It is safe to
call peekNextId() and then create() only because both are synchronous
— no other mutation can interleave between them on the event loop. The
returned id is a hint, not a reservation.
⚠️ If any repository is ever backed by an asynchronous store (e.g. a
database), this guarantee breaks. Splitting allocation into a separate
peek + create across an await boundary lets a concurrent caller consume
the previewed id first, introducing a race that does not exist today.

Required guardrails for any async-backed repository:

Allocate ids atomically inside a single transactional/atomic operation
rather than a separate peek + generate.
Never use peekNextId() to reserve an id across an await.
The synchronous-only contract is locked in by a test in
src/repositories/settlementRepository.test.ts (preview … immediate create). That test must remain green; treat its failure as a signal that a
non-atomic change to id allocation has been introduced.

CSV Export Column Coverage
Two list endpoints can serialize their results as CSV instead of JSON:

GET /api/v1/anchors?format=csv (columns derived from Anchor)
GET /api/v1/settlements?format=csv and the nested
GET /api/v1/anchors/:id/settlements?format=csv (columns derived from Settlement)

Each route module declares a CSV_COLUMNS constant that serves as both the
header row and the field order passed to toCsv() (src/utils/csv.ts).

Silent-Drift Risk (read before adding a field to Anchor or Settlement)
Because toCsv() renders any column it is given and ignores any model field it
is not given, a plain string[] of column names can fall out of sync with its
model without anything failing: a newly added field simply never reaches the
export, and consumers downloading the CSV silently lose data. This is the same
class of problem as OpenAPI spec drift, applied to export columns.

Two independent guardrails lock this down; both must stay in place.

Compile-time (structural). CSV_COLUMNS is built via
csvColumnsFor<Anchor>() / csvColumnsFor<Settlement>() rather than declared as
a bare array. The helper constrains the tuple to (keyof T & string)[] and
additionally requires it to be exhaustive, so both drift directions are build
failures rather than runtime surprises:
a column naming a field that no longer exists on the model (typo, renamed or
removed field) is rejected by the keyof constraint;
a field added to the model that no column covers is rejected by the
exhaustiveness check, and the compiler error names the uncovered field via
the CSV_COLUMNS_IS_MISSING_MODEL_FIELDS property.

Optional model fields (e.g. cancelReason?) are treated exactly like required
ones — omitting them drops data from the export just the same.

The helper returns the tuple unchanged at runtime; it is a pure type-level
guard with no behavioural effect on the response.

Runtime (contract). Tests in src/routes/anchors.test.ts and
src/routes/settlements.test.ts parse the header row of the actual CSV
response and assert the exact column list and order. Each file also asserts
the header against the keys of a real serialized API object rather than a
second hardcoded list, so a model field that reaches the JSON response but not
the CSV export fails the suite even if the expected-column list was not
updated. A further test pins the nested anchor-scoped settlement export to the
top-level settlement export so the two column constants cannot diverge.
⚠️ When adding a field to Anchor or Settlement, add it to the corresponding
CSV_COLUMNS (and, for settlements, to both the settlements route and the
nested anchors route) and to the expected-column lists in the tests. Treat a
failure in either guardrail as a real export regression, not as a test to
loosen.