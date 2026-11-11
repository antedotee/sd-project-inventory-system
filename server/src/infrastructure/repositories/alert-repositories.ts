import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { offsetOf, type Page, type PageRequest } from '../../application/pagination';
import type { AlertRepository, AlertView } from '../../application/repositories';
import type { AlertStatus, LowStockAlert } from '../../domain/low-stock-alert';
import type { Executor } from '../db/client';
import { lowStockAlerts, products } from '../db/schema';
import { alertMapper } from '../mappers';

export class DrizzleAlertRepository implements AlertRepository {
  constructor(private readonly db: Executor) {}

  async openIfNone(alert: LowStockAlert): Promise<boolean> {
    // The partial unique index (product_id WHERE status='OPEN') makes this
    // race-free: a concurrent duplicate simply does nothing.
    const rows = await this.db
      .insert(lowStockAlerts)
      .values(alert)
      .onConflictDoNothing()
      .returning({ id: lowStockAlerts.id });
    return rows.length === 1;
  }

  async resolveOpen(productId: string, at: Date): Promise<number> {
    const rows = await this.db
      .update(lowStockAlerts)
      .set({ status: 'RESOLVED', resolvedAt: at })
      .where(and(eq(lowStockAlerts.productId, productId), eq(lowStockAlerts.status, 'OPEN')))
      .returning({ id: lowStockAlerts.id });
    return rows.length;
  }

  async list(filter: { status?: AlertStatus }, page: PageRequest): Promise<Page<AlertView>> {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(lowStockAlerts.status, filter.status));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(lowStockAlerts)
        .innerJoin(products, eq(products.id, lowStockAlerts.productId))
        .where(where)
        .orderBy(desc(lowStockAlerts.createdAt), desc(lowStockAlerts.id))
        .limit(page.pageSize)
        .offset(offsetOf(page)),
      this.db.select({ n: count() }).from(lowStockAlerts).where(where),
    ]);
    return {
      items: rows.map(({ low_stock_alerts: a, products: p }) => ({
        ...alertMapper.toDomain(a),
        sku: p.sku,
        productName: p.name,
      })),
      page: page.page,
      pageSize: page.pageSize,
      total: total?.n ?? 0,
    };
  }

  async acknowledge(id: string, userId: string, at: Date): Promise<LowStockAlert | null> {
    const [updated] = await this.db
      .update(lowStockAlerts)
      .set({ acknowledgedBy: userId, acknowledgedAt: at })
      .where(and(eq(lowStockAlerts.id, id), isNull(lowStockAlerts.acknowledgedAt)))
      .returning();
    if (updated) return alertMapper.toDomain(updated);
    // Already acknowledged: return it unchanged (acknowledging twice is not an error).
    const [existing] = await this.db.select().from(lowStockAlerts).where(eq(lowStockAlerts.id, id));
    return existing ? alertMapper.toDomain(existing) : null;
  }

  async countOpen(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(lowStockAlerts).where(eq(lowStockAlerts.status, 'OPEN'));
    return row?.n ?? 0;
  }
}
