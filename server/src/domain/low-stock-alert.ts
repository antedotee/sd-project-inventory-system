export const ALERT_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/**
 * Raised when a product's available stock drops to its reorder threshold.
 * At most one OPEN alert exists per product (partial unique index). It is
 * RESOLVED automatically when stock is replenished above the threshold.
 * "Acknowledge" only records that someone has seen it.
 */
export interface LowStockAlert {
  id: string;
  productId: string;
  availableAtTrigger: number;
  threshold: number;
  status: AlertStatus;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
}
