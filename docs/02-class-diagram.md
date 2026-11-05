# 2. Class diagram

Domain classes live in `server/src/domain`, application services and ports in `server/src/application`, adapters in `server/src/infrastructure`.

## Domain model

```mermaid
classDiagram
  direction LR

  class User {
    +id: string
    +email: string
    +name: string
    +passwordHash: string
    +role: Role
    +active: boolean
    +createdAt: Date
    +hasRole(...roles) boolean
    +toPublic() PublicUser
  }

  class Category {
    +id: string
    +name: string
  }

  class Product {
    +id: string
    +sku: string
    +name: string
    +description: string
    +categoryId: string?
    +unitPriceCents: int
    +reorderPolicy: ReorderPolicy
    +active: boolean
    +version: int
    +isLowOnStock(available) boolean
  }

  class ProductBuilder {
    +static from(product) ProductBuilder
    +sku(s) ProductBuilder
    +name(n) ProductBuilder
    +unitPriceCents(c) ProductBuilder
    +reorderPolicy(p) ProductBuilder
    +build() Product
  }

  class ReorderPolicy {
    <<interface>>
    +kind
    +threshold() int
    +shouldAlert(available) boolean
    +toConfig() ReorderPolicyConfig
  }
  class FixedThresholdPolicy {
    -reorderPoint: int
  }
  class PercentageOfMaxPolicy {
    -maxStock: int
    -percent: int
  }

  class StockLevel {
    +productId: string
    -_onHand: int
    -_reserved: int
    +version: int
    +available: int
    +reserve(qty)
    +release(qty)
    +commitReservation(sale: SaleMovement)
    +apply(movement: StockMovement)
  }

  class StockMovement {
    <<abstract>>
    +id: string
    +productId: string
    +quantity: int
    +reason: string?
    +reference: MovementReference
    +actorId: string
    +createdAt: Date
    +type*: MovementType
    +delta()* int
    +validate()
  }
  class ReceiptMovement
  class SaleMovement
  class AdjustmentMovement

  class StockMovementFactory {
    +static create(type, props) StockMovement
    +static fromLedger(type, signedDelta, props) StockMovement
  }

  class Order {
    +id: string
    +number: string
    -_status: OrderStatus
    +lines: OrderLine[]
    +createdBy: string
    +version: int
    +totalCents: int
    +static place(number, lines, createdBy) Order
    +fulfil()
    +cancel()
    +canTransitionTo(status) boolean
  }

  class OrderLine {
    +productId: string
    +quantity: int
    +unitPriceCents: int
    +totalCents: int
  }

  class LowStockAlert {
    <<record>>
    +id
    +productId
    +availableAtTrigger: int
    +threshold: int
    +status: OPEN|RESOLVED
    +acknowledgedBy?
    +resolvedAt?
  }

  class LowStockEvent {
    +productId
    +available
    +threshold
  }
  class StockReplenishedEvent {
    +productId
    +available
  }

  ReorderPolicy <|.. FixedThresholdPolicy : realization
  ReorderPolicy <|.. PercentageOfMaxPolicy : realization
  StockMovement <|-- ReceiptMovement : inheritance
  StockMovement <|-- SaleMovement : inheritance
  StockMovement <|-- AdjustmentMovement : inheritance

  Product "1" *-- "1" ReorderPolicy : composition (strategy)
  Category "0..1" o-- "0..*" Product : aggregation
  Product "1" -- "1" StockLevel : has
  Product "1" -- "0..*" StockMovement : ledger
  Order "1" *-- "1..*" OrderLine : composition
  OrderLine "0..*" --> "1" Product : association
  User "1" --> "0..*" Order : creates
  User "1" --> "0..*" StockMovement : records
  Product "1" -- "0..1" LowStockAlert : open alert
  ProductBuilder ..> Product : builds
  StockMovementFactory ..> StockMovement : creates
  StockLevel ..> StockMovement : applies
```

### Relationship notes

| Relationship | Kind | Why |
|---|---|---|
| StockMovement → Receipt / Sale / Adjustment | **Inheritance** | Shared fields and `validate()`; each subclass defines its own `delta()` and extra rules. |
| ReorderPolicy → Fixed / PercentageOfMax | **Interface realization** | Interchangeable strategies. |
| Order ◆— OrderLine (1..\*) | **Composition** | Lines have no life outside their order; saved and deleted with it (`ON DELETE CASCADE`). |
| Product ◆— ReorderPolicy (1) | **Composition** | The policy object belongs to exactly one product. |
| Category ◇— Product (0..\*) | **Aggregation** | A category groups products; deleting it leaves the products (`ON DELETE SET NULL`). |
| OrderLine → Product (1) | **Association** | A line references a product; the product exists independently (`ON DELETE RESTRICT`). |
| User → Order (0..\*) | **Association** | `orders.created_by`. |
| Product — StockLevel (1..1) | **Association, one-to-one** | Shared primary key `stock_levels.product_id`. Created in the same transaction as the product. |

## Application layer

```mermaid
classDiagram
  direction TB

  class TransactionRunner {
    <<interface>>
    +run(work: (uow) => Promise~T~) Promise~T~
  }
  class UnitOfWork {
    <<interface>>
    +products: ProductRepository
    +stockLevels: StockLevelReader & StockLevelWriter
    +movements: StockMovementRepository
    +orders: OrderRepository
    +record(event)
  }
  class EventBus {
    <<interface>>
    +subscribe(name, handler)
    +publish(events)
  }
  class StockLevelReader {
    <<interface>>
    +findByProductId(id)
    +list(filter, page)
  }
  class StockLevelWriter {
    <<interface>>
    +create(level)
    +lockForUpdate(ids) StockLevel[]
    +save(level)
  }
  class ProductRepository {
    <<interface>>
  }
  class OrderRepository {
    <<interface>>
  }
  class AlertRepository {
    <<interface>>
  }

  class DrizzleTransactionRunner
  class RetryingTransactionRunner {
    -inner: TransactionRunner
    -options: RetryOptions
  }
  class InProcessEventBus
  class Database {
    <<singleton>>
    -static instance
    +static connect(url, size) Database
    +ping()
    +close()
  }

  class AuthService
  class ProductService
  class StockService
  class OrderService
  class AlertService
  class LowStockAlertListener
  class IdempotencyService

  TransactionRunner <|.. DrizzleTransactionRunner
  TransactionRunner <|.. RetryingTransactionRunner
  RetryingTransactionRunner o-- TransactionRunner : decorates
  EventBus <|.. InProcessEventBus
  DrizzleTransactionRunner --> EventBus : publishes after commit
  DrizzleTransactionRunner ..> UnitOfWork : creates per tx
  DrizzleTransactionRunner --> Database

  OrderService --> TransactionRunner
  OrderService --> OrderRepository
  StockService --> TransactionRunner
  StockService --> StockLevelReader : read-only (ISP)
  ProductService --> TransactionRunner
  ProductService --> ProductRepository
  AlertService --> AlertRepository
  LowStockAlertListener --> AlertRepository
  LowStockAlertListener ..> EventBus : subscribes
```

The HTTP layer (`server/src/http/routes/*`) depends on services only; `container.ts` is the only place that creates concrete classes.
