import { beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { LowStockEvent } from '../../src/domain/events';
import { DrizzleTransactionRunner } from '../../src/infrastructure/transaction/drizzle-transaction-runner';
import { InProcessEventBus } from '../../src/infrastructure/event-bus';
import { LowStockAlertListener } from '../../src/application/alerts';
import { DrizzleAlertRepository } from '../../src/infrastructure/repositories/alert-repositories';
import { call, createProduct, loginAs, makeTestApp, receive, resetDb } from '../helpers';

const ctx = makeTestApp();
const db = () => ctx.container.database.db;
let admin: string;
let staff: string;

beforeEach(async () => {
  await resetDb(ctx);
  admin = (await loginAs(ctx, 'ADMIN')).cookie;
  staff = (await loginAs(ctx, 'STAFF')).cookie;
});

async function ledgerSum(productId: string): Promise<number> {
  const [row] = await db().execute<{ s: number }>(
    sql`select coalesce(sum(quantity), 0)::int as s from stock_movements where product_id = ${productId}`,
  );
  return row!.s;
}

async function alertsFor(productId: string) {
  return db().execute<{ status: string }>(sql`select status from low_stock_alerts where product_id = ${productId} order by created_at`);
}

describe('stock ledger', () => {
  test('receipt and adjustment update the level and the ledger together', async () => {
    const p = await createProduct(ctx, admin);
    const r = await receive(ctx, staff, p.id, 20);
    expect(r).toMatchObject({ onHand: 20, reserved: 0, available: 20 });

    const adj = await call(ctx, 'POST', '/api/stock/adjustments', {
      cookie: admin,
      body: { productId: p.id, delta: -3, reason: 'damaged in storage' },
    });
    expect(adj.status).toBe(201);
    expect(adj.json.onHand).toBe(17);

    const history = await call(ctx, 'GET', `/api/stock/${p.id}/movements`, { cookie: staff });
    expect(history.json.items.map((m: { type: string; delta: number }) => [m.type, m.delta])).toEqual([
      ['ADJUSTMENT', -3],
      ['RECEIPT', 20],
    ]);
    expect(await ledgerSum(p.id)).toBe(17);
  });

  test('adjusting below zero -> 409 and nothing is written', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 2);
    const res = await call(ctx, 'POST', '/api/stock/adjustments', {
      cookie: admin,
      body: { productId: p.id, delta: -5, reason: 'stock count' },
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await ledgerSum(p.id)).toBe(2);
  });

  test('STAFF may receive but not adjust; adjustments need a reason', async () => {
    const p = await createProduct(ctx, admin);
    expect(
      (await call(ctx, 'POST', '/api/stock/adjustments', { cookie: staff, body: { productId: p.id, delta: 1, reason: 'found' } })).status,
    ).toBe(403);
    expect((await call(ctx, 'POST', '/api/stock/adjustments', { cookie: admin, body: { productId: p.id, delta: 1 } })).status).toBe(400);
  });

  test('the ledger is append-only at the database level', async () => {
    const p = await createProduct(ctx, admin);
    await receive(ctx, staff, p.id, 5);
    await expect(Promise.resolve(db().execute(sql`update stock_movements set quantity = 500`))).rejects.toThrow();
    await expect(Promise.resolve(db().execute(sql`delete from stock_movements`))).rejects.toThrow();
    expect(await ledgerSum(p.id)).toBe(5);
  });

  test('CHECK constraints stop impossible stock levels even if app code is bypassed', async () => {
    const p = await createProduct(ctx, admin);
    await expect(Promise.resolve(db().execute(sql`update stock_levels set reserved = 1 where product_id = ${p.id}`))).rejects.toThrow();
  });

  test('ledger sum equals on_hand after many concurrent receipts', async () => {
    const p = await createProduct(ctx, admin);
    await Promise.all(Array.from({ length: 25 }, () => receive(ctx, staff, p.id, 2)));
    const stock = await call(ctx, 'GET', '/api/stock', { cookie: staff });
    expect(stock.json.items[0].onHand).toBe(50);
    expect(await ledgerSum(p.id)).toBe(50);
  });
});

describe('low-stock alerts (Strategy + Observer)', () => {
  test('dropping to the reorder point opens exactly one alert, even if it happens twice', async () => {
    const p = await createProduct(ctx, admin, { reorderPoint: 5 });
    await receive(ctx, staff, p.id, 10);
    expect(await alertsFor(p.id)).toHaveLength(0);

    for (const delta of [-5, -1]) {
      await call(ctx, 'POST', '/api/stock/adjustments', { cookie: admin, body: { productId: p.id, delta, reason: 'count' } });
    }
    const alerts = await alertsFor(p.id);
    expect(alerts.map((a) => a.status)).toEqual(['OPEN']);

    const list = await call(ctx, 'GET', '/api/alerts?status=OPEN', { cookie: staff });
    expect(list.json.items[0]).toMatchObject({ productId: p.id, threshold: 5, availableAtTrigger: 5, sku: p.sku });
    expect((await call(ctx, 'GET', '/api/alerts/open-count', { cookie: staff })).json.open).toBe(1);
  });

  test('a receipt above the threshold resolves the alert', async () => {
    const p = await createProduct(ctx, admin, { reorderPoint: 5 });
    await receive(ctx, staff, p.id, 3); // still low -> opens alert
    expect((await alertsFor(p.id)).map((a) => a.status)).toEqual(['OPEN']);
    await receive(ctx, staff, p.id, 10);
    expect((await alertsFor(p.id)).map((a) => a.status)).toEqual(['RESOLVED']);
  });

  test('acknowledge records who saw it and keeps it OPEN', async () => {
    const p = await createProduct(ctx, admin, { reorderPoint: 5 });
    await receive(ctx, staff, p.id, 1);
    const [alert] = (await call(ctx, 'GET', '/api/alerts', { cookie: staff })).json.items;
    const ack = await call(ctx, 'POST', `/api/alerts/${alert.id}/acknowledge`, { cookie: staff });
    expect(ack.status).toBe(200);
    expect(ack.json.status).toBe('OPEN');
    expect(ack.json.acknowledgedAt).toBeTruthy();
  });

  test('events from a rolled-back transaction are never published', async () => {
    const p = await createProduct(ctx, admin, { reorderPoint: 5 });
    const bus = new InProcessEventBus(ctx.container.logger);
    new LowStockAlertListener(new DrizzleAlertRepository(db()), { now: () => new Date() }).register(bus);
    const runner = new DrizzleTransactionRunner(db(), bus);

    await expect(
      runner.run(async (uow) => {
        uow.record(new LowStockEvent(p.id, 0, 5));
        throw new Error('fail after recording');
      }),
    ).rejects.toThrow('fail after recording');
    expect(await alertsFor(p.id)).toHaveLength(0);

    await runner.run(async (uow) => uow.record(new LowStockEvent(p.id, 0, 5)));
    expect(await alertsFor(p.id)).toHaveLength(1);
  });

  test('lowOnly filter uses the per-product threshold', async () => {
    const low = await createProduct(ctx, admin, { reorderPoint: 5, name: 'Low' });
    const ok = await createProduct(ctx, admin, { reorderPoint: 5, name: 'Fine' });
    await receive(ctx, staff, low.id, 2);
    await receive(ctx, staff, ok.id, 50);
    const res = await call(ctx, 'GET', '/api/stock?lowOnly=true', { cookie: staff });
    expect(res.json.items.map((r: { name: string }) => r.name)).toEqual(['Low']);
  });
});
