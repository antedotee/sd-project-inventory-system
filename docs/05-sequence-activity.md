# 5. Sequence and activity diagrams

## 5.1 Place an order (reserve stock)

```mermaid
sequenceDiagram
  autonumber
  actor U as Staff (browser)
  participant MW as Hono middleware<br/>(requestId, csrf, session, requireAuth)
  participant R as orderRoutes
  participant OS as OrderService
  participant TX as RetryingTransactionRunner
  participant DT as DrizzleTransactionRunner
  participant DB as Postgres
  participant BUS as EventBus
  participant L as LowStockAlertListener

  U->>MW: POST /api/orders {lines}
  MW->>R: user loaded from session
  R->>R: zod validate body (400 on failure)
  R->>OS: place(input, userId)
  OS->>TX: run(work)
  TX->>DT: run(work)
  DT->>DB: BEGIN
  OS->>DB: SELECT products WHERE id IN (...)
  OS->>DB: SELECT stock_levels ... ORDER BY product_id FOR UPDATE
  loop each line
    OS->>OS: level.reserve(qty)
  end
  alt a line is short
    OS-->>DT: throw InsufficientStockError
    DT->>DB: ROLLBACK
    R-->>U: 409 INSUFFICIENT_STOCK {productId, requested, available}
  else all reserved
    OS->>DB: nextval(order_number_seq), INSERT orders, order_lines
    OS->>DB: UPDATE stock_levels (reserved)
    OS->>OS: uow.record(LowStockEvent | StockReplenishedEvent)
    DT->>DB: COMMIT
    DT->>BUS: publish(events)
    BUS->>L: onLowStock → INSERT alert ON CONFLICT DO NOTHING
    R-->>U: 201 {order}
  end
  Note over TX,DT: On deadlock (40P01) / serialization (40001)<br/>the whole run() is retried with jittered backoff (max 3).
```

## 5.2 Fulfil or cancel an order

```mermaid
sequenceDiagram
  autonumber
  actor U as Staff
  participant OS as OrderService
  participant O as Order (domain)
  participant F as StockMovementFactory
  participant SL as StockLevel (domain)
  participant DB as Postgres

  U->>OS: POST /orders/:id/fulfil
  OS->>DB: BEGIN, SELECT orders WHERE id FOR UPDATE
  OS->>O: fulfil()
  alt status is not RESERVED
    O-->>U: 409 INVALID_STATE_TRANSITION
  end
  OS->>DB: SELECT stock_levels ... ORDER BY product_id FOR UPDATE
  loop each line
    OS->>F: create('SALE', {qty, reference: ORDER id})
    F-->>OS: SaleMovement (validated)
    OS->>SL: commitReservation(sale)  (reserved -= q, onHand -= q)
    OS->>DB: INSERT stock_movements
  end
  OS->>DB: UPDATE orders SET status, version+1 WHERE version = ?
  OS->>DB: UPDATE stock_levels
  OS->>DB: COMMIT
  OS-->>U: 200 {status: FULFILLED}
  Note over U,DB: Cancel is the same shape: order.cancel(), level.release(q), no ledger rows.<br/>Fulfil and cancel racing on one order: the order row lock serialises them, and the second sees a final status → 409.
```

## 5.3 Receive / adjust stock and the alert reaction

```mermaid
sequenceDiagram
  autonumber
  actor A as Admin / Staff
  participant SS as StockService
  participant F as StockMovementFactory
  participant P as Product + ReorderPolicy
  participant DB as Postgres
  participant BUS as EventBus
  participant L as LowStockAlertListener

  A->>SS: POST /stock/adjustments {productId, delta, reason}
  SS->>F: create('ADJUSTMENT', ...) → validate (reason required, delta ≠ 0)
  SS->>DB: BEGIN, SELECT product, SELECT stock_level FOR UPDATE
  SS->>SS: level.apply(movement)  (409 if below reserved)
  SS->>DB: INSERT stock_movements, UPDATE stock_levels
  SS->>P: isLowOnStock(level.available)  [Strategy]
  P-->>SS: true → record LowStockEvent / false → StockReplenishedEvent
  SS->>DB: COMMIT
  SS->>BUS: publish
  alt LowStock
    BUS->>L: INSERT low_stock_alerts ON CONFLICT DO NOTHING<br/>(partial unique index: one OPEN per product)
  else Replenished
    BUS->>L: UPDATE low_stock_alerts SET RESOLVED WHERE status = OPEN
  end
  SS-->>A: 201 {onHand, reserved, available}
```

## 5.4 Activity: order lifecycle

```mermaid
flowchart TD
  start([Staff submits order]) --> valid{Body valid?}
  valid -- no --> e400[400 with field errors] --> done([End])
  valid -- yes --> lock[Lock stock rows<br/>sorted by product id]
  lock --> enough{Every line has<br/>enough available?}
  enough -- no --> rollback[Roll back everything] --> e409[409 INSUFFICIENT_STOCK<br/>on the short line] --> done
  enough -- yes --> reserved[Order RESERVED<br/>reserved += qty]
  reserved --> commit[Commit, then publish events]
  commit --> low{Available ≤ threshold?}
  low -- yes --> alert[Open alert if none open]
  low -- no --> wait
  alert --> wait{What happens next?}
  wait -- ship --> fulfil[FULFILLED<br/>SALE movements<br/>onHand and reserved decrease]
  wait -- cancel --> cancel[CANCELLED<br/>reservation released]
  fulfil --> final([Final: no further transitions])
  cancel --> final
```

## 5.5 Activity: sign-in and session check

```mermaid
flowchart TD
  a([POST /auth/login]) --> rl{More than 5 attempts<br/>in 60 s for IP + email?}
  rl -- yes --> r429[429 + Retry-After]
  rl -- no --> verify{User exists, active,<br/>password matches?}
  verify -- no --> r401[401 INVALID_CREDENTIALS<br/>same timing for unknown email]
  verify -- yes --> new[Drop old session cookie if any<br/>new 32-byte token<br/>store SHA-256 only]
  new --> cookie[Set httpOnly SameSite=Lax cookie<br/>__Host- + Secure in production]
  req([Any later request]) --> find{"Hash of cookie in sessions<br/>and not expired?"}
  find -- no --> anon[user = null → 401 on protected routes]
  find -- yes --> active{User still active?}
  active -- no --> kill[Delete session → 401]
  active -- yes --> roll{Less than half of<br/>8 h left?}
  roll -- yes --> extend[Extend and re-issue cookie]
  roll -- no --> ok[Continue]
  extend --> ok
```
