import { NotFoundError, ValidationError, VersionConflictError } from '../domain/errors';
import { Order, OrderLine, type OrderStatus } from '../domain/order';
import type { Product } from '../domain/product';
import type { StockLevel } from '../domain/stock-level';
import { type SaleMovement, StockMovementFactory } from '../domain/stock-movement';
import type { Page, PageRequest } from './pagination';
import type { TransactionRunner, UnitOfWork } from './ports';
import type { OrderRepository, OrderSummary, ProductRepository } from './repositories';
import { stockEventFor } from './stock-events';

export interface PlaceOrderInput {
  lines: { productId: string; quantity: number }[];
}

export interface OrderDetails {
  order: Order;
  products: Map<string, Product>;
}

/**
 * Orchestrates the order lifecycle: place (reserve) -> fulfil | cancel.
 *
 * Concurrency: every operation locks the affected stock rows with
 * SELECT ... FOR UPDATE in ascending productId order (see
 * StockLevelWriter.lockForUpdate). Two orders for the same product therefore
 * run one after the other, and the second sees the first one's reservation.
 * Sorted locking means two multi-line orders can never deadlock.
 */
export class OrderService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly orders: OrderRepository,
    private readonly products: ProductRepository,
  ) {}

  list(filter: { status?: OrderStatus }, page: PageRequest): Promise<Page<OrderSummary>> {
    return this.orders.list(filter, page);
  }

  async get(id: string): Promise<OrderDetails> {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundError('Order', id);
    const products = await this.products.findManyByIds(order.lines.map((l) => l.productId));
    return { order, products: new Map(products.map((p) => [p.id, p])) };
  }

  place(input: PlaceOrderInput, actorId: string): Promise<Order> {
    return this.tx.run(async (uow) => {
      const productIds = input.lines.map((l) => l.productId);
      const products = await this.loadActiveProducts(uow, productIds);
      const levels = await this.lock(uow, productIds);

      // Reserve every line. The first shortage throws and rolls back all lines.
      for (const line of input.lines) levels.get(line.productId)!.reserve(line.quantity);

      const lines = input.lines.map(
        (l) => new OrderLine(l.productId, l.quantity, products.get(l.productId)!.unitPriceCents),
      );
      const order = Order.place(await uow.orders.nextNumber(), lines, actorId);
      await uow.orders.create(order);
      await this.saveAndRecord(uow, levels, products);
      return order;
    });
  }

  fulfil(orderId: string, actorId: string): Promise<Order> {
    return this.tx.run(async (uow) => {
      const order = await this.lockOrder(uow, orderId);
      order.fulfil(); // throws InvalidStateTransitionError unless RESERVED
      const productIds = order.lines.map((l) => l.productId);
      const levels = await this.lock(uow, productIds);

      for (const line of order.lines) {
        const sale = StockMovementFactory.create('SALE', {
          productId: line.productId,
          quantity: line.quantity,
          reference: { type: 'ORDER', id: order.id },
          actorId,
        }) as SaleMovement;
        levels.get(line.productId)!.commitReservation(sale);
        await uow.movements.append(sale);
      }

      await this.saveOrder(uow, order);
      await this.saveAndRecord(uow, levels, await this.loadProducts(uow, productIds));
      return order;
    });
  }

  cancel(orderId: string): Promise<Order> {
    return this.tx.run(async (uow) => {
      const order = await this.lockOrder(uow, orderId);
      order.cancel();
      const productIds = order.lines.map((l) => l.productId);
      const levels = await this.lock(uow, productIds);
      for (const line of order.lines) levels.get(line.productId)!.release(line.quantity);

      await this.saveOrder(uow, order);
      await this.saveAndRecord(uow, levels, await this.loadProducts(uow, productIds));
      return order;
    });
  }

  private async lockOrder(uow: UnitOfWork, id: string): Promise<Order> {
    const order = await uow.orders.findByIdForUpdate(id);
    if (!order) throw new NotFoundError('Order', id);
    return order;
  }

  private async saveOrder(uow: UnitOfWork, order: Order) {
    if (!(await uow.orders.saveStatus(order))) throw new VersionConflictError('Order', order.id);
  }

  private async lock(uow: UnitOfWork, productIds: string[]): Promise<Map<string, StockLevel>> {
    const levels = await uow.stockLevels.lockForUpdate(productIds);
    return new Map(levels.map((l) => [l.productId, l]));
  }

  private async loadProducts(uow: UnitOfWork, ids: string[]): Promise<Map<string, Product>> {
    const products = await uow.products.findManyByIds(ids);
    return new Map(products.map((p) => [p.id, p]));
  }

  private async loadActiveProducts(uow: UnitOfWork, ids: string[]): Promise<Map<string, Product>> {
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('Each product may appear only once per order');
    }
    const products = await this.loadProducts(uow, ids);
    for (const id of ids) {
      const p = products.get(id);
      if (!p || !p.active) throw new NotFoundError('Product', id);
    }
    return products;
  }

  private async saveAndRecord(uow: UnitOfWork, levels: Map<string, StockLevel>, products: Map<string, Product>) {
    for (const level of levels.values()) {
      await uow.stockLevels.save(level);
      uow.record(stockEventFor(products.get(level.productId)!, level));
    }
  }
}
