# 6. API and layer design

Base path `/api`. JSON in, JSON out. Authentication is the session cookie (`sp_session`, or `__Host-sp_session` in production).

## Layers

```
HTTP request
  └─ middleware (http/app.ts): requestId → secureHeaders → access log → csrf → bodyLimit(64 KB) → loadSession
       └─ route = controller (http/routes/*.ts): requireAuth / requireRole → validate(zod) → call service → presenter
            └─ service (application/*.ts): business flow, transactions, events
                 └─ repository interface (application/repositories.ts)
                      └─ Drizzle implementation (infrastructure/repositories/*.ts) → Postgres
```
Errors from any layer go up to `app.onError` (`http/error-handler.ts`).

## Conventions
- **Errors:** always `{ "error": { "code": "…", "message": "…", "details"?: …, "requestId": "…" } }`. Status mapping is in `08-error-handling.md`.
- **Pagination:** `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, total }`.
- **Money** is integer cents; **quantities** are integers.
- **Ids** are UUIDv7.
- **Validation failure** → 400 with `details: { location: "json" | "query" | "param" | "header", fields: [{ path, message }] }`.

## Endpoints

| Method & path | Role | Body / query | Success | Errors |
|---|---|---|---|---|
| `GET /health` | none | n/a | 200 `{status:"ok"}` | 500 if DB down |
| `POST /auth/login` | none | `{email, password}` | 200 `{user}` + Set-Cookie | 400, 401 `INVALID_CREDENTIALS`, 429 `RATE_LIMITED` |
| `POST /auth/logout` | none | n/a | 204, cookie cleared | n/a |
| `GET /auth/me` | any | n/a | 200 `{user}` | 401 |
| `POST /users` | ADMIN | `{email, name, password(≥12), role}` | 201 `{user}` | 400, 403, 409 `DUPLICATE` |
| `GET /categories` | any | n/a | 200 `{items}` | 401 |
| `POST /categories` | ADMIN | `{name}` | 201 `{id,name}` | 400, 403, 409 |
| `GET /products` | any | `q, categoryId, page, pageSize` | 200 page of Product | 400 |
| `GET /products/:id` | any | n/a | 200 Product | 400, 404 |
| `POST /products` | ADMIN | `{sku, name, description?, categoryId?, unitPriceCents, reorderPolicy}` | 201 Product | 400, 403, 404 category, 409 `DUPLICATE` |
| `PATCH /products/:id` | ADMIN | any of the above except sku, **plus `version`** | 200 Product (version+1) | 400, 404, 409 `VERSION_CONFLICT` |
| `DELETE /products/:id` | ADMIN | n/a | 200 Product (`active:false`) | 404 |
| `GET /stock` | any | `q, lowOnly, page, pageSize` | 200 page of StockRow | 400 |
| `GET /stock/:productId/movements` | any | `page, pageSize` | 200 page of Movement | 404 |
| `POST /stock/receipts` | any | `{productId, quantity ≥1, note?}` | 201 StockChange | 400, 404 |
| `POST /stock/adjustments` | ADMIN | `{productId, delta ≠0, reason (≥3)}` | 201 StockChange | 400, 403, 404, 409 `INSUFFICIENT_STOCK` |
| `POST /orders` | any | `{lines:[{productId, quantity}]}` (1–50 lines) | 201 Order | 400, 404, 409 `INSUFFICIENT_STOCK` |
| `GET /orders` | any | `status, page, pageSize` | 200 page of OrderSummary | 400 |
| `GET /orders/:id` | any | n/a | 200 Order (lines include sku/name) | 404 |
| `POST /orders/:id/fulfil` | any | n/a | 200 Order | 404, 409 `INVALID_STATE_TRANSITION` |
| `POST /orders/:id/cancel` | any | n/a | 200 Order | 404, 409 `INVALID_STATE_TRANSITION` |
| `GET /alerts` | any | `status, page, pageSize` | 200 page of Alert | 400 |
| `GET /alerts/open-count` | any | n/a | 200 `{open}` | n/a |
| `POST /alerts/:id/acknowledge` | any | n/a | 200 Alert | 404 |

## Examples

**Create a product**
```http
POST /api/products
Content-Type: application/json

{ "sku": "bolt-m8", "name": "M8 bolt", "unitPriceCents": 25,
  "reorderPolicy": { "kind": "FIXED", "reorderPoint": 10 } }
```
```json
201
{ "id": "01a1…", "sku": "BOLT-M8", "name": "M8 bolt", "description": "", "categoryId": null,
  "unitPriceCents": 25, "reorderPolicy": { "kind": "FIXED", "reorderPoint": 10 },
  "reorderThreshold": 10, "active": true, "version": 1, "createdAt": "…", "updatedAt": "…" }
```

**Place an order (and a short line)**
```http
POST /api/orders

{ "lines": [ { "productId": "01a1…", "quantity": 4 } ] }
```
```json
201
{ "id": "01a2…", "number": "SO-1003", "status": "RESERVED", "totalCents": 100,
  "lines": [ { "productId": "01a1…", "quantity": 4, "unitPriceCents": 25, "totalCents": 100 } ],
  "allowedActions": { "fulfil": true, "cancel": true }, "createdAt": "…", "updatedAt": "…", "createdBy": "…" }
```
```json
409
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Only 1 available, 4 requested",
  "details": { "productId": "01a1…", "requested": 4, "available": 1 }, "requestId": "…" } }
```

**Stale edit**
```json
PATCH /api/products/01a1… { "name": "New", "version": 1 }   →   409
{ "error": { "code": "VERSION_CONFLICT", "message": "Product 01a1… was changed by someone else. Reload and try again.", "details": { "entity": "Product", "id": "01a1…" }, "requestId": "…" } }
```

**Validation**
```json
400
{ "error": { "code": "VALIDATION_FAILED", "message": "Request is invalid",
  "details": { "location": "json", "fields": [ { "path": "lines.0.quantity", "message": "Too small: expected number to be >=1" } ] },
  "requestId": "…" } }
```

## Service interfaces (method signatures)

```ts
AuthService.login(email, password, clientIp): Promise<{ token, user, expiresAt }>
AuthService.authenticate(token): Promise<{ user, session, renewed } | null>
AuthService.logout(token): Promise<void>
UserService.create({ email, name, password, role }): Promise<User>
UserService.bootstrapAdmin(email?, password?): Promise<'created' | 'skipped'>
CategoryService.list(): Promise<Category[]>;  create(name): Promise<Category>
ProductService.search(filter, page): Promise<Page<Product>>
ProductService.get(id): Promise<Product>
ProductService.create(input): Promise<Product>
ProductService.update(id, patch, expectedVersion): Promise<Product>
ProductService.deactivate(id): Promise<Product>
StockService.list(filter, page): Promise<Page<StockOverviewRow>>
StockService.history(productId, page): Promise<Page<StockMovement>>
StockService.receive(productId, quantity, note, actorId): Promise<StockChangeResult>
StockService.adjust(productId, delta, reason, actorId): Promise<StockChangeResult>
OrderService.place({ lines }, actorId): Promise<Order>
OrderService.fulfil(orderId, actorId): Promise<Order>
OrderService.cancel(orderId): Promise<Order>
OrderService.list(filter, page) / get(id)
AlertService.list(filter, page) / countOpen() / acknowledge(id, userId)
```
