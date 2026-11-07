/**
 * Domain events (OBSERVER pattern payloads). They are recorded during a
 * transaction and published only after it commits, so listeners never
 * react to a change that was rolled back.
 */
export class LowStockEvent {
  readonly name = 'LowStock';
  constructor(
    readonly productId: string,
    readonly available: number,
    readonly threshold: number,
  ) {}
}

export class StockReplenishedEvent {
  readonly name = 'StockReplenished';
  constructor(
    readonly productId: string,
    readonly available: number,
  ) {}
}

export type DomainEvent = LowStockEvent | StockReplenishedEvent;
export type DomainEventName = DomainEvent['name'];
