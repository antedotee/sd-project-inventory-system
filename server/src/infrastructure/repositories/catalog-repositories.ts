import { and, asc, count, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { offsetOf, type Page, type PageRequest } from '../../application/pagination';
import type { CategoryRepository, ProductFilter, ProductRepository } from '../../application/repositories';
import { Category } from '../../domain/category';
import { DuplicateError } from '../../domain/errors';
import type { Product } from '../../domain/product';
import type { Executor } from '../db/client';
import { PG, pgError } from '../db/pg-errors';
import { categories, products } from '../db/schema';
import { productMapper } from '../mappers';

export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly db: Executor) {}

  async list(): Promise<Category[]> {
    const rows = await this.db.select().from(categories).orderBy(asc(categories.name));
    return rows.map((r) => new Category(r.id, r.name));
  }

  async findById(id: string): Promise<Category | null> {
    const [row] = await this.db.select().from(categories).where(eq(categories.id, id));
    return row ? new Category(row.id, row.name) : null;
  }

  async create(category: Category): Promise<Category> {
    try {
      await this.db.insert(categories).values({ id: category.id, name: category.name });
      return category;
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) {
        throw new DuplicateError('A category with this name already exists', { field: 'name' });
      }
      throw err;
    }
  }
}

/** Escape LIKE wildcards so user input is matched literally. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly db: Executor) {}

  async findById(id: string): Promise<Product | null> {
    const [row] = await this.db.select().from(products).where(eq(products.id, id));
    return row ? productMapper.toDomain(row) : null;
  }

  async findManyByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(products).where(inArray(products.id, ids));
    return rows.map(productMapper.toDomain);
  }

  async search(filter: ProductFilter, page: PageRequest): Promise<Page<Product>> {
    const conditions: SQL[] = [];
    if (!filter.includeInactive) conditions.push(eq(products.active, true));
    if (filter.categoryId) conditions.push(eq(products.categoryId, filter.categoryId));
    if (filter.q) {
      const term = likeContains(filter.q.trim().toLowerCase());
      conditions.push(or(sql`lower(${products.name}) LIKE ${term}`, ilike(products.sku, term))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(where)
        .orderBy(asc(products.name), asc(products.id))
        .limit(page.pageSize)
        .offset(offsetOf(page)),
      this.db.select({ n: count() }).from(products).where(where),
    ]);
    return { items: rows.map(productMapper.toDomain), page: page.page, pageSize: page.pageSize, total: total?.n ?? 0 };
  }

  async create(product: Product): Promise<Product> {
    try {
      const [row] = await this.db.insert(products).values(productMapper.toRow(product)).returning();
      return productMapper.toDomain(row!);
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) {
        throw new DuplicateError(`A product with SKU ${product.sku} already exists`, { field: 'sku' });
      }
      throw err;
    }
  }

  async update(product: Product, expectedVersion: number): Promise<Product | null> {
    const { id: _id, version: _v, ...changes } = productMapper.toRow(product);
    const [row] = await this.db
      .update(products)
      .set({ ...changes, version: sql`${products.version} + 1`, updatedAt: new Date() })
      .where(and(eq(products.id, product.id), eq(products.version, expectedVersion)))
      .returning();
    return row ? productMapper.toDomain(row) : null;
  }
}
