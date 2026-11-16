import { beforeEach, describe, expect, test } from 'bun:test';
import { call, createProduct, fixedPolicy, loginAs, makeTestApp, resetDb } from '../helpers';

const ctx = makeTestApp();
let admin: string;
let staff: string;

beforeEach(async () => {
  await resetDb(ctx);
  admin = (await loginAs(ctx, 'ADMIN')).cookie;
  staff = (await loginAs(ctx, 'STAFF')).cookie;
});

describe('products', () => {
  test('ADMIN creates a product; it starts with an empty stock level', async () => {
    const res = await call(ctx, 'POST', '/api/products', {
      cookie: admin,
      body: { sku: 'bolt-m8', name: 'M8 bolt', unitPriceCents: 25, reorderPolicy: fixedPolicy(10) },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ sku: 'BOLT-M8', version: 1, reorderThreshold: 10 });

    const stock = await call(ctx, 'GET', '/api/stock', { cookie: staff });
    expect(stock.json.items[0]).toMatchObject({ sku: 'BOLT-M8', onHand: 0, reserved: 0, available: 0, low: true });
  });

  test('STAFF cannot create products', async () => {
    const res = await call(ctx, 'POST', '/api/products', {
      cookie: staff,
      body: { sku: 'X-1', name: 'X', unitPriceCents: 1, reorderPolicy: fixedPolicy(0) },
    });
    expect(res.status).toBe(403);
  });

  test('duplicate SKU -> 409 DUPLICATE', async () => {
    await createProduct(ctx, admin, { sku: 'DUP-1' });
    const res = await call(ctx, 'POST', '/api/products', {
      cookie: admin,
      body: { sku: 'dup-1', name: 'Again', unitPriceCents: 1, reorderPolicy: fixedPolicy(0) },
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('DUPLICATE');
  });

  test('invalid payload -> 400 with one entry per field', async () => {
    const res = await call(ctx, 'POST', '/api/products', {
      cookie: admin,
      body: { sku: '', unitPriceCents: -5, reorderPolicy: { kind: 'PERCENT_OF_MAX', maxStock: 0, percent: 500 } },
    });
    expect(res.status).toBe(400);
    const paths = res.json.error.details.fields.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(['name', 'reorderPolicy.maxStock', 'reorderPolicy.percent', 'sku', 'unitPriceCents']);
  });

  test('optimistic locking: a stale version -> 409 VERSION_CONFLICT', async () => {
    const p = await createProduct(ctx, admin);
    const first = await call(ctx, 'PATCH', `/api/products/${p.id}`, { cookie: admin, body: { name: 'Edit A', version: 1 } });
    expect(first.status).toBe(200);
    expect(first.json.version).toBe(2);

    const second = await call(ctx, 'PATCH', `/api/products/${p.id}`, { cookie: admin, body: { name: 'Edit B', version: 1 } });
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('VERSION_CONFLICT');
  });

  test('two concurrent edits with the same version: exactly one wins', async () => {
    const p = await createProduct(ctx, admin);
    const results = await Promise.all(
      ['A', 'B', 'C'].map((name) => call(ctx, 'PATCH', `/api/products/${p.id}`, { cookie: admin, body: { name, version: 1 } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  test('unknown category -> 404; bad id -> 400', async () => {
    const res = await call(ctx, 'POST', '/api/products', {
      cookie: admin,
      body: {
        sku: 'CAT-1',
        name: 'X',
        unitPriceCents: 1,
        categoryId: '00000000-0000-7000-8000-000000000000',
        reorderPolicy: fixedPolicy(0),
      },
    });
    expect(res.status).toBe(404);
    expect((await call(ctx, 'GET', '/api/products/not-a-uuid', { cookie: staff })).status).toBe(400);
  });

  test('search, pagination and soft delete', async () => {
    await createProduct(ctx, admin, { name: 'Washer' });
    await createProduct(ctx, admin, { name: 'Wall plug' });
    const gone = await createProduct(ctx, admin, { name: 'Wallpaper' });
    expect((await call(ctx, 'DELETE', `/api/products/${gone.id}`, { cookie: admin })).json.active).toBe(false);

    const res = await call(ctx, 'GET', '/api/products?q=wa&pageSize=1', { cookie: staff });
    expect(res.json.total).toBe(2);
    expect(res.json.items).toHaveLength(1);
    expect(res.json.items[0].name).toBe('Wall plug');

    // LIKE wildcards in user input are matched literally.
    expect((await call(ctx, 'GET', '/api/products?q=%25', { cookie: staff })).json.total).toBe(0);
  });
});

describe('categories', () => {
  test('ADMIN creates; names are unique case-insensitively', async () => {
    expect((await call(ctx, 'POST', '/api/categories', { cookie: admin, body: { name: 'Fasteners' } })).status).toBe(201);
    const dup = await call(ctx, 'POST', '/api/categories', { cookie: admin, body: { name: 'fasteners' } });
    expect(dup.status).toBe(409);
    const list = await call(ctx, 'GET', '/api/categories', { cookie: staff });
    expect(list.json.items.map((c: { name: string }) => c.name)).toEqual(['Fasteners']);
  });
});
