/**
 * Presenters turn domain objects into JSON response bodies (SRP: routes do
 * not hand-build response shapes; the API contract lives here).
 */
import type { Page } from '../application/pagination';
import type { Order } from '../domain/order';
import type { Product } from '../domain/product';
import type { StockMovement } from '../domain/stock-movement';

export function presentPage<T, R>(page: Page<T>, present: (item: T) => R) {
  return { items: page.items.map(present), page: page.page, pageSize: page.pageSize, total: page.total };
}

export function presentProduct(p: Product) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    unitPriceCents: p.unitPriceCents,
    reorderPolicy: p.reorderPolicy.toConfig(),
    reorderThreshold: p.reorderPolicy.threshold(),
    active: p.active,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function presentMovement(m: StockMovement) {
  return {
    id: m.id,
    type: m.type,
    delta: m.delta(),
    reason: m.reason,
    reference: m.reference,
    actorId: m.actorId,
    createdAt: m.createdAt,
  };
}

export function presentOrder(order: Order, products?: Map<string, Product>) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    totalCents: order.totalCents,
    lines: order.lines.map((l) => ({
      productId: l.productId,
      sku: products?.get(l.productId)?.sku,
      name: products?.get(l.productId)?.name,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      totalCents: l.totalCents,
    })),
    createdBy: order.createdBy,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    allowedActions: {
      fulfil: order.canTransitionTo('FULFILLED'),
      cancel: order.canTransitionTo('CANCELLED'),
    },
  };
}
