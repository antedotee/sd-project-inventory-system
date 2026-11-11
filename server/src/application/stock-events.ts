import { type DomainEvent, LowStockEvent, StockReplenishedEvent } from '../domain/events';
import type { Product } from '../domain/product';
import type { StockLevel } from '../domain/stock-level';

/**
 * After any stock change, report whether the product is now low or healthy.
 * The listener is idempotent in both directions, so emitting on every change
 * is safe and keeps this rule trivial.
 */
export function stockEventFor(product: Product, level: StockLevel): DomainEvent {
  const available = level.available;
  return product.isLowOnStock(available)
    ? new LowStockEvent(product.id, available, product.reorderPolicy.threshold())
    : new StockReplenishedEvent(product.id, available);
}
