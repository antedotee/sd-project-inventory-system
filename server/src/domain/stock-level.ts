import { InsufficientStockError, ValidationError } from './errors';
import type { SaleMovement, StockMovement } from './stock-movement';

/**
 * Current stock of one product (one row per product, single warehouse).
 *
 *   onHand    = physically on the shelf
 *   reserved  = promised to open orders, not yet shipped
 *   available = onHand - reserved  (what can still be sold)
 *
 * ENCAPSULATION: the quantities are private and only change through the
 * methods below, which enforce 0 <= reserved <= onHand. The database repeats
 * the same rules as CHECK constraints as a last line of defence.
 */
export class StockLevel {
  constructor(
    readonly productId: string,
    private _onHand: number,
    private _reserved: number,
    readonly version: number,
  ) {}

  get onHand(): number {
    return this._onHand;
  }
  get reserved(): number {
    return this._reserved;
  }
  get available(): number {
    return this._onHand - this._reserved;
  }

  /** Hold stock for an order. Fails if not enough is available. */
  reserve(quantity: number): void {
    assertPositive(quantity);
    if (quantity > this.available) {
      throw new InsufficientStockError({ productId: this.productId, requested: quantity, available: this.available });
    }
    this._reserved += quantity;
  }

  /** Give back stock held for a cancelled order. */
  release(quantity: number): void {
    assertPositive(quantity);
    if (quantity > this._reserved) {
      throw new ValidationError('Cannot release more than is reserved', { productId: this.productId });
    }
    this._reserved -= quantity;
  }

  /** Ship a reserved quantity: it leaves both `reserved` and `onHand`. */
  commitReservation(sale: SaleMovement): void {
    this.release(sale.quantity);
    this.apply(sale);
  }

  /** Apply any ledger movement. Works for every StockMovement subclass. */
  apply(movement: StockMovement): void {
    const next = this._onHand + movement.delta();
    if (next < this._reserved) {
      throw new InsufficientStockError({
        productId: this.productId,
        requested: -movement.delta(),
        available: this.available,
      });
    }
    this._onHand = next;
  }
}

function assertPositive(quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('Quantity must be a positive whole number', { quantity });
  }
}
