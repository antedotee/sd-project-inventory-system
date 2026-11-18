# 9. Evaluation guide

A map from each evaluation criterion to the files to open and the test or action that proves it. Server paths are relative to `server/`.

| # | Criterion | Read | Prove |
|---|---|---|---|
| 1 | Requirement analysis | `docs/01-requirements.md` (actors, F1–F10, N1–N8, use-case diagram, UC5 with alternative flows) | n/a |
| 2 | Class diagram | `docs/02-class-diagram.md` (domain + application diagrams, relationship table with multiplicities) | The classes exist with those names in `src/domain`, `src/application`, `src/infrastructure` |
| 3 | OOP | `docs/03-oop-solid.md`; `src/domain/stock-movement.ts` (abstract class + 3 subclasses), `src/domain/stock-level.ts` (encapsulation), `src/domain/reorder-policy.ts` (interface + 2 implementations) | `test/unit/domain.test.ts` |
| 4 | SOLID | `docs/03-oop-solid.md` (one section per letter with file paths); `src/container.ts` (DIP) | `test/contract/product-repository.contract.test.ts` (LSP: one suite, two implementations); `test/unit/auth-service.test.ts` (DIP: service tested with in-memory adapters) |
| 5 | Design patterns | `docs/04-patterns.md` (each pattern: where, problem, why not simpler) | Decorator: `test/unit/infrastructure.test.ts` (retries 40P01). Observer: same file + `stock-and-alerts.test.ts`. Strategy, Builder, Factory: `domain.test.ts` |
| 6 | Sequence / activity diagrams | `docs/05-sequence-activity.md` (place order, fulfil/cancel, receive/adjust with alerts; order lifecycle; sign-in) | Steps match `src/application/order-service.ts` and `src/http/middleware/idempotency.ts` line by line |
| 7 | API / interface design | `docs/06-api.md` (endpoints, examples, service signatures); layers: `src/http/routes` → `src/application` → `src/application/repositories.ts` → `src/infrastructure/repositories` | `test/integration/*.test.ts` call every endpoint |
| 8 | Database schema | `docs/07-database.md` (ER diagram, class → table mapping, constraint and index rationale); `src/infrastructure/db/schema.ts`; `drizzle/0000_init.sql`, `drizzle/0001_ledger_and_search.sql` | `stock-and-alerts.test.ts`: the append-only trigger and CHECK constraints reject raw SQL |
| 9 | Error handling, validation, concurrency | `docs/08-error-handling.md` (every scenario → the test that proves it); `src/http/error-handler.ts`; `src/domain/errors.ts` | `orders.test.ts`: **50 parallel orders vs 10 units → exactly 10 succeed**; sorted locks prevent deadlock; idempotent replay; 422 on body mismatch; fulfil/cancel race |
| 10 | Working implementation | `README.md` | `bun run test` (106 server + 9 web tests); `docker compose -f docker-compose.prod.yml up --build`; the UI at `localhost:5173` (dev) or `:8080` (prod) |

## Suggested 10-minute walkthrough

1. **Requirements → design (2 min):** `01-requirements.md`, then the class diagram. Point out the composition of Order and OrderLine, the aggregation of Category and Product, and the StockMovement inheritance.
2. **Code mirrors the diagram (2 min):** open `domain/stock-level.ts` and `domain/stock-movement.ts`. Show how `apply()` uses polymorphism and how `StockMovementFactory` creates subclasses.
3. **One request through every layer (2 min):** `http/routes/order-routes.ts` → `idempotent()` → `OrderService.place` → `RetryingTransactionRunner` → `DrizzleTransactionRunner` → `lockForUpdate` → commit → `LowStockAlertListener`. Compare with sequence diagram 5.1.
4. **Prove it (2 min):** run `bun test test/integration/orders.test.ts` and read the test names aloud: no overselling, rollback, no deadlock, idempotency.
5. **Database (1 min):** `07-database.md` constraints table. Run `bun test test/integration/stock-and-alerts.test.ts` to show the trigger and the CHECK constraints rejecting raw SQL.
6. **UI (1 min):** sign in as staff and place an order larger than available. The error appears on that order line. Receive stock and the alert resolves. Sign in as admin and edit a product in two tabs to see the version conflict dialog.

## Likely questions

- **Why `SELECT … FOR UPDATE` rather than `SERIALIZABLE`?** The contended resource is known (stock rows). Locking exactly those rows, in a fixed order, is predictable and does not abort unrelated transactions. Serialization failures are still retried by the decorator if they occur.
- **Why both domain checks and database CHECKs?** The domain gives precise, user-facing errors. The database protects the data against bugs and manual SQL.
- **Why is the session token hashed?** A leaked database dump cannot be used to impersonate anyone.
- **What changes for multiple app instances?** The login rate limiter and the event bus are in-memory. Both sit behind interfaces (`RateLimiter`, `EventBus`), so a Redis limiter or a transactional outbox can be swapped in from `container.ts` alone.
- **Why store `reorder_threshold`?** So "low stock only" is a SQL filter with correct pagination. It is recomputed from the strategy on every save.
