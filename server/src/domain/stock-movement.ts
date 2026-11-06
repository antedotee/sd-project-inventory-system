import { ValidationError } from './errors';
import { newId } from './id';

export const MOVEMENT_TYPES = ['RECEIPT', 'SALE', 'ADJUSTMENT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface MovementReference {
  type: 'ORDER' | 'MANUAL';
  id: string | null;
}

export interface MovementProps {
  id?: string;
  productId: string;
  /** Receipt/Sale: positive amount moved. Adjustment: signed change. */
  quantity: number;
  reason?: string | null;
  reference?: MovementReference;
  actorId: string;
  createdAt?: Date;
}

/**
 * One immutable line in the stock ledger. INHERITANCE + POLYMORPHISM:
 * every subclass answers `delta()` (its signed effect on on-hand stock), and
 * StockLevel.apply() works with any of them without knowing which one it got
 * (Liskov Substitution).
 */
export abstract class StockMovement {
  abstract readonly type: MovementType;
  readonly id: string;
  readonly productId: string;
  readonly quantity: number;
  readonly reason: string | null;
  readonly reference: MovementReference;
  readonly actorId: string;
  readonly createdAt: Date;

  constructor(props: MovementProps) {
    this.id = props.id ?? newId();
    this.productId = props.productId;
    this.quantity = props.quantity;
    this.reason = props.reason?.trim() || null;
    this.reference = props.reference ?? { type: 'MANUAL', id: null };
    this.actorId = props.actorId;
    this.createdAt = props.createdAt ?? new Date();
  }

  /** Signed change to on-hand quantity. This is what gets stored in the ledger. */
  abstract delta(): number;

  /** Subclasses add their own rules; the base rule applies to all. */
  validate(): void {
    if (!Number.isInteger(this.quantity) || this.quantity === 0) {
      throw new ValidationError('Quantity must be a non-zero whole number', { quantity: this.quantity });
    }
  }
}

export class ReceiptMovement extends StockMovement {
  readonly type = 'RECEIPT';
  delta(): number {
    return this.quantity;
  }
  override validate(): void {
    super.validate();
    if (this.quantity < 0) throw new ValidationError('A receipt must add stock (quantity > 0)');
  }
}

export class SaleMovement extends StockMovement {
  readonly type = 'SALE';
  delta(): number {
    return -this.quantity;
  }
  override validate(): void {
    super.validate();
    if (this.quantity < 0) throw new ValidationError('A sale quantity must be positive');
    if (this.reference.type !== 'ORDER' || !this.reference.id) {
      throw new ValidationError('A sale must reference the order it fulfils');
    }
  }
}

export class AdjustmentMovement extends StockMovement {
  readonly type = 'ADJUSTMENT';
  delta(): number {
    return this.quantity;
  }
  override validate(): void {
    super.validate();
    if (!this.reason) throw new ValidationError('An adjustment needs a reason (e.g. "damaged", "stock count")');
  }
}

/**
 * FACTORY pattern: the single place that turns a movement type into the
 * right subclass, and guarantees every movement is validated on creation.
 * Callers (StockService, OrderService, the repository mapper) never `new`
 * a subclass directly.
 */
export class StockMovementFactory {
  private static readonly constructors: Record<MovementType, new (props: MovementProps) => StockMovement> = {
    RECEIPT: ReceiptMovement,
    SALE: SaleMovement,
    ADJUSTMENT: AdjustmentMovement,
  };

  static create(type: MovementType, props: MovementProps): StockMovement {
    const movement = new StockMovementFactory.constructors[type](props);
    movement.validate();
    return movement;
  }

  /** Rebuild from a stored ledger row, where `quantity` holds the signed delta. */
  static fromLedger(type: MovementType, signedDelta: number, props: Omit<MovementProps, 'quantity'>): StockMovement {
    const quantity = type === 'SALE' ? -signedDelta : signedDelta;
    return StockMovementFactory.create(type, { ...props, quantity });
  }
}
