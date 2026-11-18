# 3. Object-oriented design and SOLID

Paths are relative to `server/src/`.

## OOP pillars

| Pillar | Where | What to point at |
|---|---|---|
| **Abstraction** | `domain/stock-movement.ts` (`abstract class StockMovement`, `abstract delta()`), `application/ports.ts` (`TransactionRunner`, `EventBus`, `PasswordHasher`, `RateLimiter`), `application/repositories.ts` | Services talk to "a repository" or "a transaction runner", never to Drizzle or Postgres. |
| **Encapsulation** | `domain/stock-level.ts` | `_onHand` / `_reserved` are private; they only change through `reserve`, `release`, `commitReservation`, `apply`, which keep `0 ≤ reserved ≤ onHand`. `domain/order.ts`: `_status` only changes via `fulfil()`/`cancel()` through the transition table. `domain/product.ts`: immutable; changes go through `Product.with()`, which re-validates. |
| **Inheritance** | `ReceiptMovement`, `SaleMovement`, `AdjustmentMovement extends StockMovement`; `InvalidCredentialsError extends UnauthenticatedError extends AppError`; all errors extend `AppError` (`domain/errors.ts`) | Subclasses override `validate()` and call `super.validate()`. |
| **Polymorphism** | `StockLevel.apply(movement)` calls `movement.delta()` without knowing the subclass. `Product.isLowOnStock()` calls whichever `ReorderPolicy` it holds. `http/error-handler.ts` maps any `AppError` by its `kind`. | |

**Interfaces vs abstract classes.** `StockMovement` is an *abstract class* because subclasses share state (id, product, actor…) and the base validation. `ReorderPolicy`, repositories and ports are *interfaces* because implementations share nothing but the contract.

## SOLID

### S: Single Responsibility
| Class / file | Its one job |
|---|---|
| `http/routes/*.ts` | Parse and validate the request, call one service method, shape the response. No business rules. |
| `http/presenters.ts` | Turn domain objects into JSON. |
| `http/error-handler.ts` | Map errors to HTTP status + body. |
| `application/stock-service.ts` | Manual stock changes (receive / adjust) and stock reads. |
| `application/order-service.ts` | Order lifecycle orchestration. |
| `application/auth-service.ts` | Authentication and sessions only. User creation is in `user-service.ts`. |
| `infrastructure/mappers.ts` | Row ⇄ domain conversion only. |
| `infrastructure/transaction/retrying-transaction-runner.ts` | Retry policy only. |

### O: Open/Closed
- **New reorder rule:** add a class implementing `ReorderPolicy` and one `case` in `reorderPolicyFrom` (`domain/reorder-policy.ts`). `StockService`, `OrderService` and the listener are untouched.
- **New movement type** (e.g. `RETURN`): a subclass of `StockMovement` plus one entry in `StockMovementFactory.constructors`. `StockLevel.apply` already handles it.
- **New reaction to low stock** (e.g. email): another `bus.subscribe('LowStock', …)` in `container.ts`. No change to stock code.
- **Retries:** added by wrapping (`RetryingTransactionRunner`), not by editing `DrizzleTransactionRunner`.

### L: Liskov Substitution
- Any `StockMovement` subclass can be passed to `StockLevel.apply()`; tested in `test/unit/domain.test.ts` ("apply() accepts every StockMovement subclass").
- `InMemoryProductRepository` and `DrizzleProductRepository` pass **the same** contract suite (`test/contract/product-repository.contract.test.ts`): same duplicate behaviour (`DuplicateError`), same version semantics, same search/sort/pagination. The Drizzle repo translates Postgres `23505` into `DuplicateError` precisely so it honours the contract.
- `RetryingTransactionRunner` is a `TransactionRunner` and is used wherever one is expected.

### I: Interface Segregation
- `StockLevelReader` (find, list) and `StockLevelWriter` (create, lockForUpdate, save) are separate (`application/repositories.ts`). `StockService` receives only a `StockLevelReader` for its reads; writes happen only through the `UnitOfWork` inside a transaction.
- Route factories receive only the services they use: `orderRoutes(orders)`, `stockRoutes(stock)`, and so on.
- `AuthService` needs `PasswordHasher`, `RateLimiter` and `Clock`: three small ports instead of one "security" god-interface.

### D: Dependency Inversion
- Services take interfaces in their constructors (`OrderService(tx: TransactionRunner, orders: OrderRepository, products: ProductRepository)`).
- `container.ts` is the composition root and the only file that imports concrete Drizzle/Bun classes and wires them.
- Effect: `AuthService` is unit-tested with in-memory repositories and a fake clock (`test/unit/auth-service.test.ts`); the retry decorator is tested with a fake inner runner.
- The domain never imports infrastructure: `domain/` has no imports from `infrastructure/` or `http/`.
