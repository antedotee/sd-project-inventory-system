import { and, count, desc, eq, type SQL, sql } from 'drizzle-orm';
import { offsetOf, type Page, type PageRequest } from '../../application/pagination';
import type { OrderRepository, OrderSummary } from '../../application/repositories';
import type { Order, OrderStatus } from '../../domain/order';
import type { Executor } from '../db/client';
import { orderLines, orderNumberSeq, orders } from '../db/schema';
import { orderMapper } from '../mappers';

export class DrizzleOrderRepository implements OrderRepository {
  constructor(private readonly db: Executor) {}

  async nextNumber(): Promise<string> {
    const [row] = await this.db.execute<{ n: string }>(sql`select nextval(${orderNumberSeq.seqName}) as n`);
    return `SO-${row!.n}`;
  }

  async create(order: Order): Promise<void> {
    await this.db.insert(orders).values({
      id: order.id,
      number: order.number,
      status: order.status,
      createdBy: order.createdBy,
      version: order.version,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
    await this.db.insert(orderLines).values(
      order.lines.map((l) => ({
        orderId: order.id,
        productId: l.productId,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
      })),
    );
  }

  findById(id: string): Promise<Order | null> {
    return this.load(id, false);
  }

  findByIdForUpdate(id: string): Promise<Order | null> {
    return this.load(id, true);
  }

  async list(filter: { status?: OrderStatus }, page: PageRequest): Promise<Page<OrderSummary>> {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(orders.status, filter.status));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: orders.id,
          number: orders.number,
          status: orders.status,
          createdBy: orders.createdBy,
          createdAt: orders.createdAt,
          totalCents: sql<number>`coalesce(sum(${orderLines.quantity} * ${orderLines.unitPriceCents}), 0)::int`,
          lineCount: sql<number>`count(${orderLines.productId})::int`,
        })
        .from(orders)
        .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
        .where(where)
        .groupBy(orders.id)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(page.pageSize)
        .offset(offsetOf(page)),
      this.db.select({ n: count() }).from(orders).where(where),
    ]);
    return { items: rows, page: page.page, pageSize: page.pageSize, total: total?.n ?? 0 };
  }

  async saveStatus(order: Order): Promise<boolean> {
    const rows = await this.db
      .update(orders)
      .set({ status: order.status, updatedAt: order.updatedAt, version: sql`${orders.version} + 1` })
      .where(and(eq(orders.id, order.id), eq(orders.version, order.version)))
      .returning({ id: orders.id });
    return rows.length === 1;
  }

  private async load(id: string, lock: boolean): Promise<Order | null> {
    const query = this.db.select().from(orders).where(eq(orders.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) return null;
    const lines = await this.db.select().from(orderLines).where(eq(orderLines.orderId, id));
    return orderMapper.toDomain(row, lines);
  }
}
