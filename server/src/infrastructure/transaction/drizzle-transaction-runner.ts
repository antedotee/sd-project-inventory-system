import type { EventBus, TransactionRunner, UnitOfWork } from '../../application/ports';
import type { DomainEvent } from '../../domain/events';
import type { Db } from '../db/client';
import { DrizzleProductRepository } from '../repositories/catalog-repositories';
import { DrizzleOrderRepository } from '../repositories/order-repositories';
import { DrizzleStockLevelRepository, DrizzleStockMovementRepository } from '../repositories/stock-repositories';

/**
 * Runs work inside one Postgres transaction (READ COMMITTED + row locks).
 * Events recorded during the work are published only after COMMIT, so a
 * rolled-back change can never trigger an alert.
 */
export class DrizzleTransactionRunner implements TransactionRunner {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
  ) {}

  async run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    const events: DomainEvent[] = [];
    const result = await this.db.transaction(async (tx) => {
      const uow: UnitOfWork = {
        products: new DrizzleProductRepository(tx),
        stockLevels: new DrizzleStockLevelRepository(tx),
        movements: new DrizzleStockMovementRepository(tx),
        orders: new DrizzleOrderRepository(tx),
        record: (event) => events.push(event),
      };
      return work(uow);
    });
    await this.bus.publish(events); // never throws (see InProcessEventBus)
    return result;
  }
}
