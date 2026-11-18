# StockPilot

A small inventory management system for one warehouse. It tracks products and stock levels, reserves stock for orders, keeps an append-only stock ledger, and raises low-stock alerts. It is built to stay correct under concurrent requests, retries and bad input.

- **Server:** Bun, Hono, zod, Drizzle ORM, PostgreSQL 16
- **Web:** React 19, Vite, Tailwind CSS v4, TanStack Query, Base UI
- **Design docs:** [`docs/`](docs) (start with [`09-evaluation-guide.md`](docs/09-evaluation-guide.md))

## Run it locally

Requirements: Bun ≥ 1.2, Docker.

```sh
bun install
docker compose up -d                 # Postgres on localhost:5433 (dev + test databases)
cp .env.example server/.env          # then edit ADMIN_EMAIL / ADMIN_PASSWORD
bun run seed                         # optional sample data (refuses to run in production)
bun run dev:server                   # API on :3000 (runs migrations, creates the first admin)
bun run dev:web                      # UI on http://localhost:5173 (proxies /api to :3000)
```

Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `server/.env`. After seeding, a staff account also exists: `staff@stockpilot.local` / `staff-password-123`.

## Test

```sh
bun run test        # server: unit + contract + integration against stockpilot_test; web: Vitest
bun run typecheck
```

Server integration tests need the Docker database running. They refuse to run unless `DATABASE_URL` points at a `*_test` database.

## Production

```sh
POSTGRES_PASSWORD=… ADMIN_EMAIL=… ADMIN_PASSWORD=… APP_ORIGIN=https://stock.example.com \
  docker compose -f docker-compose.prod.yml up -d --build
```

- One container serves the API and the built UI from the same origin.
- Migrations run on start.
- The first admin is created only when the users table is empty.
- The healthcheck is `GET /api/health`.
- SIGTERM drains requests and closes the database pool.
- In production the session cookie is `__Host-sp_session` with `Secure`. Put an HTTPS reverse proxy in front, and set `APP_ORIGIN` to the public origin.

## Layout

```
server/src/
  domain/          entities, value objects, errors, events, reorder strategies
  application/     services, repository interfaces, ports
  infrastructure/  Drizzle schema + repositories, transaction runners, event bus, security adapters
  http/            Hono app, routes (controllers), zod schemas, middleware, presenters, error handler
  container.ts     composition root
  main.ts          startup, housekeeping, graceful shutdown
server/drizzle/    SQL migrations
server/test/       unit, contract and integration tests
web/src/           pages, components, API client
docs/              requirements, diagrams, patterns, API, database, error handling
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection string |
| `APP_ORIGIN` | (required) | Origin the browser uses. Used for the CSRF check. |
| `PORT` | 3000 | HTTP port |
| `DB_POOL_SIZE` | 10 | Connections in the pool |
| `SESSION_TTL_HOURS` | 8 | Session lifetime (rolling) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | (none) | First admin, used only when there are no users. The password needs at least 12 characters. |
| `STATIC_DIR` | (unset) | Directory of the built UI to serve |
| `LOG_LEVEL` | info | pino log level |
