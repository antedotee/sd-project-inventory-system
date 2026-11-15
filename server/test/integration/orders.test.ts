import { beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { call, createProduct, idemKey, loginAs, makeTestApp, receive, resetDb } from '../helpers';

const ctx = makeTestApp();
let admin: string;
let staff: string;

beforeEach(async () => {
  await resetDb(ctx);
  admin = (await loginAs(ctx, 'ADMIN')).cookie;
  staff = (await loginAs(ctx, 'STAFF')).cookie;
});

function placeOrder(lines: { productId: string; quantity: number }[], key = idemKey(), cookie = staff) {
  return call(ctx, 'POST', '/api/orders', { cookie, body: { lines }, headers: { 'Idempotency-Key': key } });
}

async function level(productId: string) {
  const rows = (await call(ctx, 'GET', '/api/stock?pageSize=100', { cookie: staff })).json.items;
  return rows.find((r: { productId: string }) => r.productId === productId);
}

describe('placing orders', () => {
  test('reserves stock and returns RESERVED', async () => {
    const p = await createProduct(ctx, admin, { unitPriceCents: 250 });
    await receive(ctx, staff, p.id, 10);
    const res = await placeOrder([{ productId: p.id, quantity: 4 }]);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ status: 'RESERVED', totalCents: 1000 });
    expect(res.json.number).toMatch(/^SO-\d+$/);
    expect(await level(p.id)).toMatchObject({ onHand: 10, reserved: 4, available: 6 });
  });

  test('NO OVERSELLING: 50 concurrent orders for 1 unit against 10 in stock -> exactly 10 succeed', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);

    const results = await Promise.all(Array.from({ length: 50 }, () => placeOrder([{ productId: p.id, quantity: 1 }])));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(40);
    expect(results.find((r) => r.status === 409)!.json.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await level(p.id)).toMatchObject({ onHand: 10, reserved: 10, available: 0 });
  });

  test('multi-line order where one line is short rolls back completely', async () => {
    const a = await createProduct(ctx, admin);
    const b = await createProduct(ctx, admin);
    await receive(ctx, staff, a.id, 10);
    await receive(ctx, staff, b.id, 1);

    const res = await placeOrder([
      { productId: a.id, quantity: 5 },
      { productId: b.id, quantity: 2 },
    ]);
    expect(res.status).toBe(409);
    expect(res.json.error.details).toEqual({ productId: b.id, requested: 2, available: 1 });
    expect((await level(a.id)).reserved).toBe(0);
    const [orders] = await ctx.container.database.db.execute<{ n: number }>(sql`select count(*)::int as n from orders`);
    expect(orders!.n).toBe(0);
  });

  test('opposite-order multi-line orders do not deadlock (sorted locking)', async () => {
    const a = await createProduct(ctx, admin);
    const b = await createProduct(ctx, admin);
    await receive(ctx, staff, a.id, 100);
    await receive(ctx, staff, b.id, 100);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        placeOrder(
          i % 2
            ? [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }]
            : [{ productId: b.id, quantity: 1 }, { productId: a.id, quantity: 1 }],
        ),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await level(a.id)).reserved).toBe(20);
    expect((await level(b.id)).reserved).toBe(20);
  });

  test('validation: empty lines, duplicate products, unknown product', async () => {
    const p = await createProduct(ctx, admin);
    expect((await placeOrder([])).status).toBe(400);
    expect(
      (
        await placeOrder([
          { productId: p.id, quantity: 1 },
          { productId: p.id, quantity: 1 },
        ])
      ).status,
    ).toBe(400);
    expect((await placeOrder([{ productId: '00000000-0000-7000-8000-000000000000', quantity: 1 }])).status).toBe(404);
  });
});

describe('idempotency', () => {
  test('missing Idempotency-Key -> 400', async () => {
    const p = await createProduct(ctx, admin);
    const res = await call(ctx, 'POST', '/api/orders', { cookie: staff, body: { lines: [{ productId: p.id, quantity: 1 }] } });
    expect(res.status).toBe(400);
  });

  test('a retried request returns the same order and reserves stock only once', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const key = idemKey();
    const first = await placeOrder([{ productId: p.id, quantity: 3 }], key);
    const retry = await placeOrder([{ productId: p.id, quantity: 3 }], key);
    expect(retry.status).toBe(201);
    expect(retry.json.id).toBe(first.json.id);
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    expect((await level(p.id)).reserved).toBe(3);
  });

  test('concurrent duplicates: one runs, the other is told it is in progress or gets the replay', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const key = idemKey();
    const results = await Promise.all([1, 2, 3].map(() => placeOrder([{ productId: p.id, quantity: 1 }], key)));
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect((await level(p.id)).reserved).toBe(1);
  });

  test('same key with a different body -> 422', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const key = idemKey();
    await placeOrder([{ productId: p.id, quantity: 1 }], key);
    const res = await placeOrder([{ productId: p.id, quantity: 2 }], key);
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('keys are scoped per user', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const key = idemKey();
    await placeOrder([{ productId: p.id, quantity: 1 }], key, staff);
    const other = await placeOrder([{ productId: p.id, quantity: 1 }], key, admin);
    expect(other.status).toBe(201);
    expect((await level(p.id)).reserved).toBe(2);
  });
});

describe('fulfil and cancel', () => {
  test('fulfil ships reserved stock and writes SALE movements', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const order = (await placeOrder([{ productId: p.id, quantity: 4 }])).json;

    const res = await call(ctx, 'POST', `/api/orders/${order.id}/fulfil`, { cookie: staff });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('FULFILLED');
    expect(await level(p.id)).toMatchObject({ onHand: 6, reserved: 0, available: 6 });

    const history = await call(ctx, 'GET', `/api/stock/${p.id}/movements`, { cookie: staff });
    expect(history.json.items[0]).toMatchObject({ type: 'SALE', delta: -4, reference: { type: 'ORDER', id: order.id } });
  });

  test('cancel releases the reservation', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const order = (await placeOrder([{ productId: p.id, quantity: 4 }])).json;
    expect((await call(ctx, 'POST', `/api/orders/${order.id}/cancel`, { cookie: staff })).json.status).toBe('CANCELLED');
    expect(await level(p.id)).toMatchObject({ onHand: 10, reserved: 0, available: 10 });
  });

  test('fulfilling a cancelled order -> 409 INVALID_STATE_TRANSITION', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const order = (await placeOrder([{ productId: p.id, quantity: 1 }])).json;
    await call(ctx, 'POST', `/api/orders/${order.id}/cancel`, { cookie: staff });
    const res = await call(ctx, 'POST', `/api/orders/${order.id}/fulfil`, { cookie: staff });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  test('fulfil and cancel racing on the same order: exactly one wins', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 10);
    const order = (await placeOrder([{ productId: p.id, quantity: 2 }])).json;
    const [f, c] = await Promise.all([
      call(ctx, 'POST', `/api/orders/${order.id}/fulfil`, { cookie: staff }),
      call(ctx, 'POST', `/api/orders/${order.id}/cancel`, { cookie: staff }),
    ]);
    expect([f.status, c.status].sort()).toEqual([200, 409]);
    const l = await level(p.id);
    expect(l.reserved).toBe(0);
    expect([8, 10]).toContain(l.onHand);
  });

  test('reserving down to the reorder point raises an alert', async () => {
    const p = await createProduct(ctx, admin, { reorderPoint: 3 });
    await receive(ctx, staff, p.id, 10);
    await placeOrder([{ productId: p.id, quantity: 7 }]);
    const alerts = await call(ctx, 'GET', '/api/alerts?status=OPEN', { cookie: staff });
    expect(alerts.json.items.map((a: { productId: string }) => a.productId)).toEqual([p.id]);
  });

  test('order list and details', async () => {
    const p = await createProduct(ctx, admin, { name: 'Hinge' });
    await receive(ctx, staff, p.id, 10);
    const order = (await placeOrder([{ productId: p.id, quantity: 2 }])).json;
    const list = await call(ctx, 'GET', '/api/orders?status=RESERVED', { cookie: staff });
    expect(list.json.items[0]).toMatchObject({ id: order.id, lineCount: 1, totalCents: 2000 });
    const details = await call(ctx, 'GET', `/api/orders/${order.id}`, { cookie: staff });
    expect(details.json.lines[0]).toMatchObject({ name: 'Hinge', quantity: 2 });
    expect(details.json.allowedActions).toEqual({ fulfil: true, cancel: true });
  });
});
