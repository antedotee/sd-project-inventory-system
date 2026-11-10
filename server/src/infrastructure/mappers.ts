/**
 * Mappers translate between database rows and domain objects (SRP: they do
 * nothing else). This keeps Drizzle types out of the domain.
 */
import type { LowStockAlert } from '../domain/low-stock-alert';
import { Order, OrderLine } from '../domain/order';
import { type Product, ProductBuilder } from '../domain/product';
import { type ReorderPolicyConfig, reorderPolicyFrom } from '../domain/reorder-policy';
import { StockLevel } from '../domain/stock-level';
import { type StockMovement, StockMovementFactory } from '../domain/stock-movement';
import { User } from '../domain/user';
import type * as s from './db/schema';

type UserRow = typeof s.users.$inferSelect;
type ProductRow = typeof s.products.$inferSelect;
type ProductInsert = typeof s.products.$inferInsert;
type StockLevelRow = typeof s.stockLevels.$inferSelect;
type MovementRow = typeof s.stockMovements.$inferSelect;
type OrderRow = typeof s.orders.$inferSelect;
type OrderLineRow = typeof s.orderLines.$inferSelect;
type AlertRow = typeof s.lowStockAlerts.$inferSelect;

export const userMapper = {
  toDomain(r: UserRow): User {
    return new User(r.id, r.email, r.name, r.passwordHash, r.role, r.active, r.createdAt);
  },
};

export const productMapper = {
  toDomain(r: ProductRow): Product {
    const config: ReorderPolicyConfig =
      r.reorderPolicy === 'FIXED'
        ? { kind: 'FIXED', reorderPoint: r.reorderPoint! }
        : { kind: 'PERCENT_OF_MAX', maxStock: r.maxStock!, percent: r.reorderPercent! };
    return new ProductBuilder()
      .id(r.id)
      .sku(r.sku)
      .name(r.name)
      .description(r.description)
      .category(r.categoryId)
      .unitPriceCents(r.unitPriceCents)
      .reorderPolicy(reorderPolicyFrom(config))
      .active(r.active)
      .version(r.version)
      .timestamps(r.createdAt, r.updatedAt)
      .build();
  },

  toRow(p: Product): ProductInsert {
    const policy = p.reorderPolicy.toConfig();
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      unitPriceCents: p.unitPriceCents,
      reorderPolicy: policy.kind,
      reorderPoint: policy.kind === 'FIXED' ? policy.reorderPoint : null,
      maxStock: policy.kind === 'PERCENT_OF_MAX' ? policy.maxStock : null,
      reorderPercent: policy.kind === 'PERCENT_OF_MAX' ? policy.percent : null,
      reorderThreshold: p.reorderPolicy.threshold(),
      active: p.active,
      version: p.version,
    };
  },
};

export const stockLevelMapper = {
  toDomain(r: StockLevelRow): StockLevel {
    return new StockLevel(r.productId, r.onHand, r.reserved, r.version);
  },
};

export const movementMapper = {
  toDomain(r: MovementRow): StockMovement {
    return StockMovementFactory.fromLedger(r.type, r.quantity, {
      id: r.id,
      productId: r.productId,
      reason: r.reason,
      reference: { type: r.referenceType, id: r.referenceId },
      actorId: r.actorId,
      createdAt: r.createdAt,
    });
  },

  toRow(m: StockMovement): typeof s.stockMovements.$inferInsert {
    return {
      id: m.id,
      productId: m.productId,
      type: m.type,
      quantity: m.delta(),
      reason: m.reason,
      referenceType: m.reference.type,
      referenceId: m.reference.id,
      actorId: m.actorId,
      createdAt: m.createdAt,
    };
  },
};

export const orderMapper = {
  toDomain(r: OrderRow, lines: OrderLineRow[]): Order {
    return Order.restore(
      r.id,
      r.number,
      r.status,
      lines.map((l) => new OrderLine(l.productId, l.quantity, l.unitPriceCents)),
      r.createdBy,
      r.createdAt,
      r.updatedAt,
      r.version,
    );
  },
};

export const alertMapper = {
  toDomain(r: AlertRow): LowStockAlert {
    return { ...r };
  },
};
