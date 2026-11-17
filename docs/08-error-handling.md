# 8. Error handling, validation and edge cases

## Where each kind of check lives

| Layer | Checks | Example |
|---|---|---|
| HTTP boundary (`http/schemas.ts`, zod) | Shape, types, ranges, required fields, UUID format | `quantity` must be an integer 1–10,000; `delta ≠ 0` |
| Middleware | Auth, role, CSRF, body size, Idempotency-Key format | 401 / 403 / 413 / 400 |
| Domain (`domain/*.ts`) | Business rules | `StockLevel.reserve` refuses more than available; `Order` transition table; `ProductBuilder` SKU rule |
| Database | Last line of defence | `CHECK (reserved <= on_hand)`, unique SKU, append-only trigger, one OPEN alert per product |

Each rule is enforced at the highest layer that can give a precise message, and repeated in the database where data integrity depends on it.

## Error → status (single table in `http/error-handler.ts`)

| Error class (`domain/errors.ts`) | kind | Status | code |
|---|---|---|---|
| `ValidationError` (incl. zod failures) | validation | 400 | `VALIDATION_FAILED` |
| Hono `HTTPException` 400 (malformed JSON) | n/a | 400 | `BAD_REQUEST` |
| `UnauthenticatedError` / `InvalidCredentialsError` | unauthenticated | 401 | `UNAUTHENTICATED` / `INVALID_CREDENTIALS` |
| `ForbiddenError`, CSRF failure | forbidden | 403 | `FORBIDDEN` |
| `NotFoundError` (also unknown routes) | not_found | 404 | `NOT_FOUND` |
| body over 64 KB | n/a | 413 | `PAYLOAD_TOO_LARGE` |
| `DuplicateError`, Postgres `23505` | conflict | 409 | `DUPLICATE` |
| `VersionConflictError` | conflict | 409 | `VERSION_CONFLICT` |
| `InsufficientStockError` | conflict | 409 | `INSUFFICIENT_STOCK` |
| `InvalidStateTransitionError` | conflict | 409 | `INVALID_STATE_TRANSITION` |
| `IdempotencyInProgressError` | conflict | 409 | `IDEMPOTENCY_IN_PROGRESS` |
| Postgres `23514` / `23503` | n/a | 409 | `CONSTRAINT_VIOLATION` / `REFERENCE_VIOLATION` |
| `IdempotencyKeyMismatchError` | unprocessable | 422 | `IDEMPOTENCY_KEY_REUSED` |
| `RateLimitedError` | rate_limited | 429 + `Retry-After` | `RATE_LIMITED` |
| anything else | n/a | 500 | `INTERNAL`: logged with requestId and stack; the response has no internals |

Tested exhaustively in `server/test/integration/http-basics.test.ts`.

## Scenarios and the tests that prove them

### Invalid input
| Scenario | Behaviour | Test |
|---|---|---|
| Missing/invalid fields | 400, one entry per field with its path | `catalog.test.ts` "invalid payload" |
| Malformed JSON | 400, not 500 | `http-basics.test.ts` |
| Bad UUID in URL | 400 | `catalog.test.ts` |
| Duplicate product in one order | 400 | `orders.test.ts` "validation" |
| Negative/zero/fractional quantity | 400 (zod) / `ValidationError` (domain) | `domain.test.ts`, `orders.test.ts` |
| LIKE wildcards in search (`%`) | matched literally | `catalog.test.ts` |
| Oversized body | 413 | `http-basics.test.ts` |

### Failures
| Scenario | Behaviour | Test |
|---|---|---|
| Unexpected exception | 500 with requestId only; full error logged | `http-basics.test.ts` (secret detail not leaked) |
| A listener throws after commit | Logged; request still succeeds; other listeners still run | `infrastructure.test.ts` |
| Transaction fails after recording an event | Rolled back, **no** alert created | `stock-and-alerts.test.ts` |
| Deadlock / serialization failure | Retried up to 3× with jittered backoff; other errors are not retried | `infrastructure.test.ts` |
| Request crashes mid-idempotent call | 5xx → key discarded so the client can retry; a claim left IN_PROGRESS for over 60 s is taken over | `idempotency-service.ts` |
| DB down | `/api/health` → 500; container healthcheck fails | n/a |
| Bad configuration | Process exits at start with a list of invalid variables | `config.ts` |
| Code bypassing the app edits the ledger or breaks stock rules | Trigger / CHECK constraint rejects it | `stock-and-alerts.test.ts` |

### Concurrency
| Scenario | Behaviour | Test |
|---|---|---|
| 50 parallel orders for 1 unit, 10 in stock | exactly 10 × 201, 40 × 409, final available = 0 | `orders.test.ts` |
| Multi-line orders locking products in opposite order | all succeed, no deadlock (sorted locks) | `orders.test.ts` |
| One line short in a multi-line order | whole order rolled back | `orders.test.ts` |
| Fulfil and cancel racing on one order | exactly one wins, the other 409 | `orders.test.ts` |
| Same Idempotency-Key sent 3× at once | reserved exactly once; others 201 replay or 409 in-progress | `orders.test.ts` |
| Retry with the same key | same order, stock reserved once, `Idempotent-Replayed: true` | `orders.test.ts` |
| Same key, different body | 422 | `orders.test.ts` |
| Two admins edit the same product version | one 200, others 409 `VERSION_CONFLICT`; UI offers "Load latest version" | `catalog.test.ts`, web `app.test.tsx` |
| 25 concurrent receipts | on_hand = ledger sum = 50 | `stock-and-alerts.test.ts` |
| Threshold crossed twice / concurrently | exactly one OPEN alert (partial unique index + `ON CONFLICT DO NOTHING`) | `stock-and-alerts.test.ts` |

### Security edge cases
| Scenario | Behaviour | Test |
|---|---|---|
| Unknown email vs wrong password | same 401 and same timing (dummy hash verify) | `auth-service.test.ts` |
| Brute force | 6th attempt in 60 s per IP+email → 429 | `auth.test.ts`, `auth-service.test.ts` |
| Session fixation | a login always issues a new token and drops the old session | `auth.test.ts` |
| User deactivated while signed in | next request 401 | `auth.test.ts` |
| Cross-site form POST | 403 (Origin / Sec-Fetch-Site check) | `http-basics.test.ts` |
| STAFF calls ADMIN endpoint | 403 (UI also hides the action) | `auth.test.ts`, web `app.test.tsx` |

## Frontend behaviour on errors
- 401 anywhere → cache cleared, redirect to sign-in.
- 400 field errors are shown under the matching input (`aria-invalid`, `aria-describedby`).
- `INSUFFICIENT_STOCK` is shown on the order line it concerns.
- Network error / 5xx on "Place order" keeps the same Idempotency-Key, so pressing again is a safe retry. A 4xx or a changed form gets a new key.
- `VERSION_CONFLICT` opens a dialog to load the latest version.
- Queries retry only network/5xx failures, never 4xx.
