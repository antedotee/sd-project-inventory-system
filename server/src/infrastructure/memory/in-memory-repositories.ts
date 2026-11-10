/**
 * In-memory implementations of the same repository interfaces. Used by
 * fast unit tests, and by the shared contract tests that prove both
 * implementations behave the same (Liskov Substitution).
 */
import { offsetOf, type Page, type PageRequest } from '../../application/pagination';
import type {
  ProductFilter,
  ProductRepository,
  Session,
  SessionRepository,
  UserRepository,
} from '../../application/repositories';
import { DuplicateError } from '../../domain/errors';
import { type Product, ProductBuilder } from '../../domain/product';
import type { User } from '../../domain/user';

export class InMemoryUserRepository implements UserRepository {
  readonly rows = new Map<string, User>();

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByEmail(email: string) {
    const needle = email.trim().toLowerCase();
    return [...this.rows.values()].find((u) => u.email.toLowerCase() === needle) ?? null;
  }
  async count() {
    return this.rows.size;
  }
  async create(user: User) {
    if (await this.findByEmail(user.email)) throw new DuplicateError('email already exists');
    this.rows.set(user.id, user);
    return user;
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly rows = new Map<string, Session>();

  async create(session: Session) {
    this.rows.set(session.id, session);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async extend(id: string, expiresAt: Date) {
    const s = this.rows.get(id);
    if (s) this.rows.set(id, { ...s, expiresAt });
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async deleteExpired(now: Date) {
    let n = 0;
    for (const [id, s] of this.rows) {
      if (s.expiresAt <= now) {
        this.rows.delete(id);
        n++;
      }
    }
    return n;
  }
}

export class InMemoryProductRepository implements ProductRepository {
  private readonly rows = new Map<string, Product>();

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async findManyByIds(ids: string[]) {
    return ids.flatMap((id) => (this.rows.has(id) ? [this.rows.get(id)!] : []));
  }

  async search(filter: ProductFilter, page: PageRequest): Promise<Page<Product>> {
    const q = filter.q?.trim().toLowerCase();
    const matches = [...this.rows.values()]
      .filter((p) => filter.includeInactive || p.active)
      .filter((p) => !filter.categoryId || p.categoryId === filter.categoryId)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const start = offsetOf(page);
    return { items: matches.slice(start, start + page.pageSize), page: page.page, pageSize: page.pageSize, total: matches.length };
  }

  async create(product: Product) {
    if ([...this.rows.values()].some((p) => p.sku === product.sku)) {
      throw new DuplicateError('SKU already exists', { field: 'sku' });
    }
    this.rows.set(product.id, product);
    return product;
  }

  async update(product: Product, expectedVersion: number) {
    const current = this.rows.get(product.id);
    if (!current || current.version !== expectedVersion) return null;
    const saved = ProductBuilder.from(product)
      .version(expectedVersion + 1)
      .timestamps(product.createdAt, new Date())
      .build();
    this.rows.set(saved.id, saved);
    return saved;
  }
}
