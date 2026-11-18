# 4. Design patterns

Each pattern appears once, where it solves a real problem. Paths are relative to `server/src/`.

| Pattern | Type | Where | Problem it solves | Why not the simpler alternative |
|---|---|---|---|---|
| **Singleton** | Creational | `Database` in `infrastructure/db/client.ts`; `loadConfig()` caches in `config.ts` | A process must have exactly one Postgres connection pool. Several pools multiply connections and exhaust Postgres' limit (default 100). | A module-level variable works too, but the class makes the "one instance" rule explicit and gives `close()` a single owner for graceful shutdown. |
| **Factory** | Creational | `StockMovementFactory` in `domain/stock-movement.ts` | Movements are created from a type string in three places (receipts, sales, rebuilding from DB rows). Each must be the right subclass **and** validated. | Calling `new SaleMovement(...)` ad hoc lets someone forget `validate()` or pick the wrong class; the factory makes both impossible. |
| **Strategy** | Behavioural | `ReorderPolicy` + `FixedThresholdPolicy` / `PercentageOfMaxPolicy` in `domain/reorder-policy.ts`; `Product.isLowOnStock()` delegates | Different products need different "low stock" rules; the rule is chosen per product at runtime. | An `if (kind === …)` inside the services would spread across the code every time a rule is added. |
| **Observer** | Behavioural | `EventBus` port, `InProcessEventBus` (`infrastructure/event-bus.ts`), `LowStockAlertListener` (`application/alerts.ts`) | Stock changes must open or resolve alerts, but stock code should not depend on alerting. | Calling `alertRepo.insert` from `StockService` and `OrderService` couples them and makes the next reaction (email) another edit in both. |
| **Decorator** | Structural | `RetryingTransactionRunner` wraps `DrizzleTransactionRunner` (`infrastructure/transaction/`), wired in `container.ts` | Postgres can abort a transaction with deadlock `40P01` or serialization failure `40001`; the correct reaction is to retry the whole transaction. | Putting try/retry loops inside every service method duplicates it and mixes concerns. |
| Repository | Architectural | `application/repositories.ts` + `infrastructure/repositories/*` | Keep persistence out of the domain; allow in-memory implementations for tests. | n/a |
| Unit of Work | Architectural | `UnitOfWork` in `application/ports.ts`, created per transaction in `DrizzleTransactionRunner` | Several repositories must share one transaction, and events must be buffered until commit. | n/a |
| State (lightweight) | Behavioural | `TRANSITIONS` table in `domain/order.ts` | Legal order transitions in one place; illegal ones throw `InvalidStateTransitionError`. | Full State classes per status would be over-engineering for three states. |

## Pattern interplay in one request (fulfil an order)

1. Route → `OrderService.fulfil` (**DIP**: service got a `TransactionRunner`).
2. Runner is the **Decorator**; on a deadlock it retries the whole unit.
3. Inner runner opens a transaction and builds a **Unit of Work** over **Repositories**.
4. `order.fulfil()` checks the **State** table.
5. `StockMovementFactory.create('SALE', …)` (**Factory**) → `level.commitReservation(sale)`.
6. `stockEventFor(product, level)` asks the product's **Strategy** whether it is low and records an event.
7. After COMMIT the **Observer** bus delivers it; the listener opens or resolves the alert.
8. All of it runs on the **Singleton** connection pool.

## Considered and rejected
- **Builder** for `Product`: a fluent setter class around one validation function. `Product.create(fields)` and `product.with(patch)` collect the same field errors. The HTTP body is already checked by zod.
- **Transactional outbox** for events: needed when listeners run in another process or must never be lost. Here listeners are idempotent and in-process; a lost alert is fixed by the next stock change for that product. The `EventBus` interface would let an outbox replace it later.
- **Pessimistic vs conditional update for reservations:** I use `SELECT … FOR UPDATE` (sorted) and then domain methods, instead of `UPDATE … WHERE on_hand - reserved >= n`. The conditional update has one fewer round trip but moves the business rule into SQL and gives worse error details. With the lock, the domain object makes the decision and reports `{productId, requested, available}`. The `CHECK` constraints still back it up.
