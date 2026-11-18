import { describe, expect, test } from 'bun:test';
import { InsufficientStockError, InvalidStateTransitionError, ValidationError } from '../../src/domain/errors';
import { Order, OrderLine } from '../../src/domain/order';
import { Product } from '../../src/domain/product';
import { FixedThresholdPolicy, PercentageOfMaxPolicy } from '../../src/domain/reorder-policy';
import { StockLevel } from '../../src/domain/stock-level';
import {
  AdjustmentMovement,
  ReceiptMovement,
  SaleMovement,
  type StockMovement,
  StockMovementFactory,
} from '../../src/domain/stock-movement';

const P = '00000000-0000-7000-8000-000000000001';
const actorId = '00000000-0000-7000-8000-0000000000aa';

describe('StockMovement hierarchy + Factory', () => {
  test('each subclass reports its own signed delta', () => {
    expect(StockMovementFactory.create('RECEIPT', { productId: P, quantity: 5, actorId }).delta()).toBe(5);
    const sale = StockMovementFactory.create('SALE', {
      productId: P,
      quantity: 3,
      actorId,
      reference: { type: 'ORDER', id: P },
    });
    expect(sale.delta()).toBe(-3);
    expect(StockMovementFactory.create('ADJUSTMENT', { productId: P, quantity: -2, reason: 'damaged', actorId }).delta()).toBe(-2);
  });

  test('factory returns the right subclass', () => {
    expect(StockMovementFactory.create('RECEIPT', { productId: P, quantity: 1, actorId })).toBeInstanceOf(ReceiptMovement);
    expect(StockMovementFactory.create('ADJUSTMENT', { productId: P, quantity: 1, reason: 'count', actorId })).toBeInstanceOf(
      AdjustmentMovement,
    );
  });

  test('validation rules per subclass', () => {
    expect(() => StockMovementFactory.create('RECEIPT', { productId: P, quantity: -1, actorId })).toThrow(ValidationError);
    expect(() => StockMovementFactory.create('RECEIPT', { productId: P, quantity: 0, actorId })).toThrow(ValidationError);
    expect(() => StockMovementFactory.create('RECEIPT', { productId: P, quantity: 1.5, actorId })).toThrow(ValidationError);
    expect(() => StockMovementFactory.create('ADJUSTMENT', { productId: P, quantity: 1, actorId })).toThrow(/reason/);
    expect(() => StockMovementFactory.create('SALE', { productId: P, quantity: 1, actorId })).toThrow(/order/);
  });

  test('fromLedger round-trips the signed delta', () => {
    const sale = StockMovementFactory.fromLedger('SALE', -4, { productId: P, actorId, reference: { type: 'ORDER', id: P } });
    expect(sale).toBeInstanceOf(SaleMovement);
    expect(sale.quantity).toBe(4);
    expect(sale.delta()).toBe(-4);
  });
});

describe('StockLevel', () => {
  test('available = onHand - reserved; reserve/release/commit keep invariants', () => {
    const level = new StockLevel(P, 10, 0, 1);
    level.reserve(4);
    expect([level.onHand, level.reserved, level.available]).toEqual([10, 4, 6]);
    level.release(1);
    expect(level.reserved).toBe(3);
    const sale = StockMovementFactory.create('SALE', {
      productId: P,
      quantity: 3,
      actorId,
      reference: { type: 'ORDER', id: P },
    }) as SaleMovement;
    level.commitReservation(sale);
    expect([level.onHand, level.reserved, level.available]).toEqual([7, 0, 7]);
  });

  test('cannot reserve more than available', () => {
    const level = new StockLevel(P, 5, 3, 1);
    expect(() => level.reserve(3)).toThrow(InsufficientStockError);
    expect(level.reserved).toBe(3); // unchanged
  });

  test('apply() accepts every StockMovement subclass (Liskov)', () => {
    const movements: StockMovement[] = [
      StockMovementFactory.create('RECEIPT', { productId: P, quantity: 10, actorId }),
      StockMovementFactory.create('ADJUSTMENT', { productId: P, quantity: -2, reason: 'damaged', actorId }),
      StockMovementFactory.create('SALE', { productId: P, quantity: 3, actorId, reference: { type: 'ORDER', id: P } }),
    ];
    const level = new StockLevel(P, 0, 0, 1);
    for (const m of movements) level.apply(m);
    expect(level.onHand).toBe(5);
  });

  test('apply() refuses to go below what is reserved', () => {
    const level = new StockLevel(P, 5, 4, 1);
    const adj = StockMovementFactory.create('ADJUSTMENT', { productId: P, quantity: -2, reason: 'lost', actorId });
    expect(() => level.apply(adj)).toThrow(InsufficientStockError);
    expect(level.onHand).toBe(5);
  });
});

describe('Order state machine', () => {
  const lines = [new OrderLine(P, 2, 500)];

  test('RESERVED -> FULFILLED, then nothing else', () => {
    const order = Order.place('SO-1', lines, actorId);
    expect(order.status).toBe('RESERVED');
    expect(order.totalCents).toBe(1000);
    order.fulfil();
    expect(order.status).toBe('FULFILLED');
    expect(() => order.cancel()).toThrow(InvalidStateTransitionError);
  });

  test('a cancelled order cannot be fulfilled', () => {
    const order = Order.place('SO-2', lines, actorId);
    order.cancel();
    expect(() => order.fulfil()).toThrow(InvalidStateTransitionError);
  });

  test('order needs lines and unique products', () => {
    expect(() => Order.place('SO-3', [], actorId)).toThrow(ValidationError);
    expect(() => Order.place('SO-4', [new OrderLine(P, 1, 1), new OrderLine(P, 2, 1)], actorId)).toThrow(ValidationError);
    expect(() => new OrderLine(P, 0, 1)).toThrow(ValidationError);
  });
});

describe('Product.create', () => {
  test('creates a valid product and normalises the SKU', () => {
    const p = Product.create({ sku: ' bolt-m8 ', name: ' M8 bolt ', unitPriceCents: 25 });
    expect(p.sku).toBe('BOLT-M8');
    expect(p.name).toBe('M8 bolt');
    expect(p.version).toBe(1);
  });

  test('create() reports every invalid field at once', () => {
    try {
      Product.create({ sku: '!', name: '', unitPriceCents: -1 });
      throw new Error('expected create() to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const fields = (err as ValidationError).details as { fields: Record<string, string> };
      expect(Object.keys(fields.fields).sort()).toEqual(['name', 'sku', 'unitPriceCents']);
    }
  });

  test('with() keeps identity and applies changes', () => {
    const p = Product.create({ sku: 'A-1', name: 'A' });
    const q = p.with({ name: 'B' });
    expect(q.id).toBe(p.id);
    expect(q.name).toBe('B');
  });
});

describe('ReorderPolicy strategies', () => {
  test('fixed threshold', () => {
    const policy = new FixedThresholdPolicy(5);
    expect(policy.shouldAlert(5)).toBe(true);
    expect(policy.shouldAlert(6)).toBe(false);
  });

  test('percentage of max stock', () => {
    const policy = new PercentageOfMaxPolicy(200, 15);
    expect(policy.threshold()).toBe(30);
    expect(policy.shouldAlert(30)).toBe(true);
    expect(policy.shouldAlert(31)).toBe(false);
  });

  test('product delegates to its strategy', () => {
    const p = Product.create({ sku: 'A-1', name: 'A', reorderPolicy: new PercentageOfMaxPolicy(100, 10) });
    expect(p.isLowOnStock(10)).toBe(true);
    expect(p.isLowOnStock(11)).toBe(false);
  });

  test('invalid parameters are rejected', () => {
    expect(() => new FixedThresholdPolicy(-1)).toThrow();
    expect(() => new PercentageOfMaxPolicy(0, 10)).toThrow();
    expect(() => new PercentageOfMaxPolicy(10, 101)).toThrow();
  });
});
