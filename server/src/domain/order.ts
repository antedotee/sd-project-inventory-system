import { InvalidStateTransitionError, ValidationError } from './errors';
import { newId } from './id';

export const ORDER_STATUSES = ['RESERVED', 'FULFILLED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Lightweight STATE pattern: the allowed transitions live in one table
 * instead of if/else chains spread across services.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RESERVED: ['FULFILLED', 'CANCELLED'],
  FULFILLED: [],
  CANCELLED: [],
};

export class OrderLine {
  constructor(
    readonly productId: string,
    readonly quantity: number,
    readonly unitPriceCents: number,
  ) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Line quantity must be a positive whole number', { productId });
    }
  }

  get totalCents(): number {
    return this.quantity * this.unitPriceCents;
  }
}

/**
 * Aggregate root. COMPOSITION: an Order owns 1..* OrderLines; lines are
 * created with the order, never shared, and deleted with it.
 */
export class Order {
  private constructor(
    readonly id: string,
    readonly number: string,
    private _status: OrderStatus,
    readonly lines: readonly OrderLine[],
    readonly createdBy: string,
    readonly createdAt: Date,
    private _updatedAt: Date,
    readonly version: number,
  ) {}

  /** A new order starts RESERVED: its stock was reserved in the same transaction. */
  static place(number: string, lines: OrderLine[], createdBy: string): Order {
    if (lines.length === 0) throw new ValidationError('An order needs at least one line');
    const ids = new Set(lines.map((l) => l.productId));
    if (ids.size !== lines.length) throw new ValidationError('Each product may appear only once per order');
    const now = new Date();
    return new Order(newId(), number, 'RESERVED', lines, createdBy, now, now, 1);
  }

  static restore(
    id: string,
    number: string,
    status: OrderStatus,
    lines: OrderLine[],
    createdBy: string,
    createdAt: Date,
    updatedAt: Date,
    version: number,
  ): Order {
    return new Order(id, number, status, lines, createdBy, createdAt, updatedAt, version);
  }

  get status(): OrderStatus {
    return this._status;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get totalCents(): number {
    return this.lines.reduce((sum, l) => sum + l.totalCents, 0);
  }

  fulfil(): void {
    this.transitionTo('FULFILLED');
  }

  cancel(): void {
    this.transitionTo('CANCELLED');
  }

  canTransitionTo(next: OrderStatus): boolean {
    return TRANSITIONS[this._status].includes(next);
  }

  private transitionTo(next: OrderStatus): void {
    if (!this.canTransitionTo(next)) {
      throw new InvalidStateTransitionError('Order', this._status, next);
    }
    this._status = next;
    this._updatedAt = new Date();
  }
}
