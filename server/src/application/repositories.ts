/**
 * Repository INTERFACES. Services depend on these, never on Drizzle
 * (Dependency Inversion). Drizzle implementations live in
 * infrastructure/repositories; in-memory ones in infrastructure/memory.
 */
import type { Category } from '../domain/category';
import type { AlertStatus, LowStockAlert } from '../domain/low-stock-alert';
import type { Order, OrderStatus } from '../domain/order';
import type { Product } from '../domain/product';
import type { StockLevel } from '../domain/stock-level';
import type { StockMovement } from '../domain/stock-movement';
import type { User } from '../domain/user';
import type { Page, PageRequest } from './pagination';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  count(): Promise<number>;
  create(user: User): Promise<User>;
}

export interface Session {
  /** SHA-256 hash of the cookie token. The raw token is never stored. */
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SessionRepository {
  create(session: Session): Promise<void>;
  findById(id: string): Promise<Session | null>;
  extend(id: string, expiresAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface CategoryRepository {
  list(): Promise<Category[]>;
  findById(id: string): Promise<Category | null>;
  create(category: Category): Promise<Category>;
}

export interface ProductFilter {
  q?: string;
  categoryId?: string;
  includeInactive?: boolean;
}

export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findManyByIds(ids: string[]): Promise<Product[]>;
  search(filter: ProductFilter, page: PageRequest): Promise<Page<Product>>;
  create(product: Product): Promise<Product>;
  /** Saves only if the stored version still equals `expectedVersion`; returns null otherwise. */
  update(product: Product, expectedVersion: number): Promise<Product | null>;
}

/** Read-model row for the stock overview screen. */
export interface StockOverviewRow {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  low: boolean;
}

export interface StockFilter {
  lowOnly?: boolean;
  q?: string;
}

/** INTERFACE SEGREGATION: read-only callers depend only on this half. */
export interface StockLevelReader {
  findByProductId(productId: string): Promise<StockLevel | null>;
  list(filter: StockFilter, page: PageRequest): Promise<Page<StockOverviewRow>>;
}

export interface StockLevelWriter {
  create(level: StockLevel): Promise<void>;
  /**
   * SELECT ... FOR UPDATE, always in ascending productId order so that two
   * transactions locking overlapping products cannot deadlock.
   */
  lockForUpdate(productIds: string[]): Promise<StockLevel[]>;
  save(level: StockLevel): Promise<void>;
}

export interface StockMovementRepository {
  append(movement: StockMovement): Promise<void>;
  listByProduct(productId: string, page: PageRequest): Promise<Page<StockMovement>>;
}

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  totalCents: number;
  lineCount: number;
  createdBy: string;
  createdAt: Date;
}

export interface OrderRepository {
  nextNumber(): Promise<string>;
  create(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
  findByIdForUpdate(id: string): Promise<Order | null>;
  list(filter: { status?: OrderStatus }, page: PageRequest): Promise<Page<OrderSummary>>;
  /** Saves the status only if the stored version still equals order.version. */
  saveStatus(order: Order): Promise<boolean>;
}

export interface AlertView extends LowStockAlert {
  sku: string;
  productName: string;
}

export interface AlertRepository {
  /** Inserts unless an OPEN alert already exists for the product. Returns true if inserted. */
  openIfNone(alert: LowStockAlert): Promise<boolean>;
  resolveOpen(productId: string, at: Date): Promise<number>;
  list(filter: { status?: AlertStatus }, page: PageRequest): Promise<Page<AlertView>>;
  acknowledge(id: string, userId: string, at: Date): Promise<LowStockAlert | null>;
  countOpen(): Promise<number>;
}

export interface IdempotencyRecord {
  userId: string;
  key: string;
  requestHash: string;
  status: 'IN_PROGRESS' | 'DONE';
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
}

export type BeginResult = { kind: 'started' } | { kind: 'existing'; record: IdempotencyRecord };

export interface IdempotencyRepository {
  /** Atomically claims the key. If it exists, returns the stored record instead. */
  begin(userId: string, key: string, requestHash: string, now: Date): Promise<BeginResult>;
  /** Takes over a key whose IN_PROGRESS claim is older than `staleBefore` (crashed request). */
  reclaimStale(userId: string, key: string, staleBefore: Date, now: Date): Promise<boolean>;
  complete(userId: string, key: string, responseStatus: number, responseBody: unknown): Promise<void>;
  discard(userId: string, key: string): Promise<void>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}
