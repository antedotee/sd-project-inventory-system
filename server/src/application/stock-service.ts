import { NotFoundError } from '../domain/errors';
import { type StockMovement, StockMovementFactory } from '../domain/stock-movement';
import type { Page, PageRequest } from './pagination';
import type { TransactionRunner, UnitOfWork } from './ports';
import type {
  StockFilter,
  StockLevelReader,
  StockMovementRepository,
  StockOverviewRow,
} from './repositories';
import { stockEventFor } from './stock-events';

export interface StockChangeResult {
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
  movementId: string;
}

/**
 * SRP: the only service that records manual stock changes (receipts and
 * adjustments). Order-driven changes live in OrderService.
 *
 * Every change is: lock the stock row -> build a validated movement (Factory)
 * -> apply it to the domain object -> append to the ledger -> save the level,
 * all in one transaction.
 */
export class StockService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly levels: StockLevelReader,
    private readonly movements: StockMovementRepository,
  ) {}

  list(filter: StockFilter, page: PageRequest): Promise<Page<StockOverviewRow>> {
    return this.levels.list(filter, page);
  }

  async history(productId: string, page: PageRequest): Promise<Page<StockMovement>> {
    if (!(await this.levels.findByProductId(productId))) throw new NotFoundError('Product', productId);
    return this.movements.listByProduct(productId, page);
  }

  receive(productId: string, quantity: number, note: string | null, actorId: string): Promise<StockChangeResult> {
    return this.tx.run((uow) =>
      this.applyMovement(uow, productId, () =>
        StockMovementFactory.create('RECEIPT', { productId, quantity, reason: note, actorId }),
      ),
    );
  }

  adjust(productId: string, delta: number, reason: string, actorId: string): Promise<StockChangeResult> {
    return this.tx.run((uow) =>
      this.applyMovement(uow, productId, () =>
        StockMovementFactory.create('ADJUSTMENT', { productId, quantity: delta, reason, actorId }),
      ),
    );
  }

  private async applyMovement(
    uow: UnitOfWork,
    productId: string,
    makeMovement: () => StockMovement,
  ): Promise<StockChangeResult> {
    const movement = makeMovement(); // validates before we take any lock
    const product = await uow.products.findById(productId);
    if (!product || !product.active) throw new NotFoundError('Product', productId);

    const [level] = await uow.stockLevels.lockForUpdate([productId]);
    if (!level) throw new NotFoundError('Stock level', productId);

    level.apply(movement);
    await uow.movements.append(movement);
    await uow.stockLevels.save(level);
    uow.record(stockEventFor(product, level));

    return {
      productId,
      onHand: level.onHand,
      reserved: level.reserved,
      available: level.available,
      movementId: movement.id,
    };
  }
}
