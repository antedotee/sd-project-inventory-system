/**
 * Drizzle table definitions. This is the ONLY file that describes database
 * rows; domain classes never import it (mappers translate between them).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('user_role', ['ADMIN', 'STAFF']);
export const reorderPolicyEnum = pgEnum('reorder_policy', ['FIXED', 'PERCENT_OF_MAX']);
export const movementTypeEnum = pgEnum('movement_type', ['RECEIPT', 'SALE', 'ADJUSTMENT']);
export const referenceTypeEnum = pgEnum('movement_reference_type', ['ORDER', 'MANUAL']);
export const orderStatusEnum = pgEnum('order_status', ['RESERVED', 'FULFILLED', 'CANCELLED']);
export const alertStatusEnum = pgEnum('alert_status', ['OPEN', 'RESOLVED']);
export const idempotencyStatusEnum = pgEnum('idempotency_status', ['IN_PROGRESS', 'DONE']);

export const orderNumberSeq = pgSequence('order_number_seq', { startWith: 1000 });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // SHA-256 of the cookie token
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_expires_at_idx').on(t.expiresAt), index('sessions_user_id_idx').on(t.userId)],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('categories_name_lower_uq').on(sql`lower(${t.name})`)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    unitPriceCents: integer('unit_price_cents').notNull(),
    reorderPolicy: reorderPolicyEnum('reorder_policy').notNull(),
    reorderPoint: integer('reorder_point'),
    maxStock: integer('max_stock'),
    reorderPercent: integer('reorder_percent'),
    /** Denormalised result of the policy, so "low stock" can be filtered in SQL. */
    reorderThreshold: integer('reorder_threshold').notNull(),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_sku_uq').on(t.sku),
    // Name search uses a pg_trgm GIN index created in drizzle/0001 (drizzle-kit
    // cannot create the extension first), because ILIKE '%term%' cannot use a btree.
    index('products_category_idx').on(t.categoryId),
    check('products_price_nonneg', sql`${t.unitPriceCents} >= 0`),
    check('products_threshold_nonneg', sql`${t.reorderThreshold} >= 0`),
    check(
      'products_policy_params',
      sql`(${t.reorderPolicy} = 'FIXED' AND ${t.reorderPoint} IS NOT NULL)
       OR (${t.reorderPolicy} = 'PERCENT_OF_MAX' AND ${t.maxStock} > 0 AND ${t.reorderPercent} BETWEEN 1 AND 100)`,
    ),
  ],
);

export const stockLevels = pgTable(
  'stock_levels',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => products.id, { onDelete: 'restrict' }),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('stock_on_hand_nonneg', sql`${t.onHand} >= 0`),
    check('stock_reserved_nonneg', sql`${t.reserved} >= 0`),
    check('stock_reserved_le_on_hand', sql`${t.reserved} <= ${t.onHand}`),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    type: movementTypeEnum('type').notNull(),
    /** Signed change to on_hand. SUM(quantity) per product always equals on_hand. */
    quantity: integer('quantity').notNull(),
    reason: text('reason'),
    referenceType: referenceTypeEnum('reference_type').notNull(),
    referenceId: uuid('reference_id'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('movement_quantity_nonzero', sql`${t.quantity} <> 0`),
    index('movements_product_created_idx').on(t.productId, t.createdAt.desc()),
    index('movements_reference_idx').on(t.referenceType, t.referenceId),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    status: orderStatusEnum('status').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('orders_number_uq').on(t.number), index('orders_status_created_idx').on(t.status, t.createdAt)],
);

export const orderLines = pgTable(
  'order_lines',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.productId] }),
    index('order_lines_product_idx').on(t.productId),
    check('order_line_quantity_pos', sql`${t.quantity} > 0`),
    check('order_line_price_nonneg', sql`${t.unitPriceCents} >= 0`),
  ],
);

export const lowStockAlerts = pgTable(
  'low_stock_alerts',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    availableAtTrigger: integer('available_at_trigger').notNull(),
    threshold: integer('threshold').notNull(),
    status: alertStatusEnum('status').notNull().default('OPEN'),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    // At most one OPEN alert per product. Concurrent listeners cannot create duplicates.
    uniqueIndex('alerts_one_open_per_product_uq').on(t.productId).where(sql`${t.status} = 'OPEN'`),
    index('alerts_status_created_idx').on(t.status, t.createdAt),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatusEnum('status').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index('idempotency_created_idx').on(t.createdAt)],
);
