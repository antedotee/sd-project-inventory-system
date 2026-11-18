import { sql } from 'drizzle-orm';
import { loadConfig } from '../src/config';
import { buildContainer, type Container, type ContainerOverrides } from '../src/container';
import type { Role } from '../src/domain/user';
import { createApp } from '../src/http/app';

export interface TestContext {
  container: Container;
  app: ReturnType<typeof createApp>;
}

export function makeTestApp(overrides: ContainerOverrides = {}): TestContext {
  const container = buildContainer(loadConfig(), overrides);
  return { container, app: createApp(container) };
}

/** Empties every table. TRUNCATE does not fire the ledger's row-level DELETE trigger. */
export async function resetDb(ctx: TestContext) {
  await ctx.container.database.db.execute(sql`
    TRUNCATE low_stock_alerts, order_lines, orders, stock_movements,
             stock_levels, products, categories, sessions, users RESTART IDENTITY CASCADE`);
}

export interface RequestOptions {
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
}

export async function call(ctx: TestContext, method: string, path: string, opts: RequestOptions = {}) {
  // Browsers send Origin on every non-GET request; the CSRF check relies on it.
  const headers: Record<string, string> = { origin: ctx.container.config.APP_ORIGIN, ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await ctx.app.request(path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null; // tests assert on loosely-typed JSON
  return { status: res.status, json, headers: res.headers };
}

let userCounter = 0;
export const TEST_PASSWORD = 'correct-horse-battery';

/** Creates a user with the given role and returns a Cookie header for it. */
export async function loginAs(ctx: TestContext, role: Role, email?: string) {
  const address = email ?? `${role.toLowerCase()}${++userCounter}@test.local`;
  const user = await ctx.container.services.users.create({
    email: address,
    name: `${role} user`,
    password: TEST_PASSWORD,
    role,
  });
  const res = await ctx.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: address, password: TEST_PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { user, cookie: setCookie.split(';')[0]! };
}

export const fixedPolicy = (reorderPoint: number) => ({ kind: 'FIXED' as const, reorderPoint });

export async function createProduct(
  ctx: TestContext,
  adminCookie: string,
  overrides: Partial<{ sku: string; name: string; unitPriceCents: number; reorderPoint: number }> = {},
) {
  const res = await call(ctx, 'POST', '/api/products', {
    cookie: adminCookie,
    body: {
      sku: overrides.sku ?? `SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name: overrides.name ?? 'Test product',
      unitPriceCents: overrides.unitPriceCents ?? 1000,
      reorderPolicy: fixedPolicy(overrides.reorderPoint ?? 0),
    },
  });
  if (res.status !== 201) throw new Error(`createProduct failed: ${JSON.stringify(res.json)}`);
  return res.json as { id: string; sku: string; version: number };
}

export async function receive(ctx: TestContext, cookie: string, productId: string, quantity: number) {
  const res = await call(ctx, 'POST', '/api/stock/receipts', { cookie, body: { productId, quantity } });
  if (res.status !== 201) throw new Error(`receive failed: ${JSON.stringify(res.json)}`);
  return res.json;
}
