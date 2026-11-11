import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { offsetOf, type Page, type PageRequest } from '../../application/pagination';
import type {
  StockFilter,
  StockLevelReader,
  StockLevelWriter,
  StockMovementRepository,
  StockOverviewRow,
} from '../../application/repositories';
import type { StockLevel } from '../../domain/stock-level';
import type { StockMovement } from '../../domain/stock-movement';
import type { Executor } from '../db/client';
import { products, stockLevels, stockMovements } from '../db/schema';
import { movementMapper, stockLevelMapper } from '../mappers';

const available = sql<number>`(${stockLevels.onHand} - ${stockLevels.reserved})::int`;

/** One class implements both halves; callers only see the half they need. */
export class DrizzleStockLevelRepository implements StockLevelReader, StockLevelWriter {
  constructor(private readonly db: Executor) {}

  async findByProductId(productId: string): Promise<StockLevel | null> {
    const [row] = await this.db.select().from(stockLevels).where(eq(stockLevels.productId, productId));
    return row ? stockLevelMapper.toDomain(row) : null;
  }

  async list(filter: StockFilter, page: PageRequest): Promise<Page<StockOverviewRow>> {
    const conditions: SQL[] = [eq(products.active, true)];
    if (filter.lowOnly) conditions.push(sql`${available} <= ${products.reorderThreshold}`);
    if (filter.q) {
      // Same predicate as product search, so the lower(name) trigram index applies.
      const term = `%${filter.q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(or(sql`lower(${products.name}) LIKE ${term}`, ilike(products.sku, term))!);
    }
    const where = and(...conditions);
    const base = this.db.select().from(stockLevels).innerJoin(products, eq(products.id, stockLevels.productId));

    const [rows, [total]] = await Promise.all([
      base
        .where(where)
        .orderBy(asc(available), asc(products.name))
        .limit(page.pageSize)
        .offset(offsetOf(page)),
      this.db
        .select({ n: count() })
        .from(stockLevels)
        .innerJoin(products, eq(products.id, stockLevels.productId))
        .where(where),
    ]);

    return {
      items: rows.map(({ stock_levels: l, products: p }) => {
        const avail = l.onHand - l.reserved;
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          onHand: l.onHand,
          reserved: l.reserved,
          available: avail,
          threshold: p.reorderThreshold,
          low: avail <= p.reorderThreshold,
        };
      }),
      page: page.page,
      pageSize: page.pageSize,
      total: total?.n ?? 0,
    };
  }

  async create(level: StockLevel): Promise<void> {
    await this.db.insert(stockLevels).values({
      productId: level.productId,
      onHand: level.onHand,
      reserved: level.reserved,
      version: level.version,
    });
  }

  async lockForUpdate(productIds: string[]): Promise<StockLevel[]> {
    if (productIds.length === 0) return [];
    // ORDER BY + FOR UPDATE locks rows in a fixed order: no lock-order deadlocks.
    const rows = await this.db
      .select()
      .from(stockLevels)
      .where(inArray(stockLevels.productId, productIds))
      .orderBy(asc(stockLevels.productId))
      .for('update');
    return rows.map(stockLevelMapper.toDomain);
  }

  async save(level: StockLevel): Promise<void> {
    await this.db
      .update(stockLevels)
      .set({
        onHand: level.onHand,
        reserved: level.reserved,
        version: sql`${stockLevels.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(stockLevels.productId, level.productId));
  }
}

export class DrizzleStockMovementRepository implements StockMovementRepository {
  constructor(private readonly db: Executor) {}

  async append(movement: StockMovement): Promise<void> {
    await this.db.insert(stockMovements).values(movementMapper.toRow(movement));
  }

  async listByProduct(productId: string, page: PageRequest): Promise<Page<StockMovement>> {
    const where = eq(stockMovements.productId, productId);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(stockMovements)
        .where(where)
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(page.pageSize)
        .offset(offsetOf(page)),
      this.db.select({ n: count() }).from(stockMovements).where(where),
    ]);
    return { items: rows.map(movementMapper.toDomain), page: page.page, pageSize: page.pageSize, total: total?.n ?? 0 };
  }
}
