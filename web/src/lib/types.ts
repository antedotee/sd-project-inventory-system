/** Response shapes of the StockPilot API (see docs/06-api.md). */
export type Role = 'ADMIN' | 'STAFF';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Category {
  id: string;
  name: string;
}

export type ReorderPolicy =
  | { kind: 'FIXED'; reorderPoint: number }
  | { kind: 'PERCENT_OF_MAX'; maxStock: number; percent: number };

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  categoryId: string | null;
  unitPriceCents: number;
  reorderPolicy: ReorderPolicy;
  reorderThreshold: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  low: boolean;
}

export interface StockChange {
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
  movementId: string;
}

export type MovementType = 'RECEIPT' | 'SALE' | 'ADJUSTMENT';

export interface Movement {
  id: string;
  type: MovementType;
  delta: number;
  reason: string | null;
  reference: { type: 'ORDER' | 'MANUAL'; id: string | null };
  actorId: string;
  createdAt: string;
}

export type OrderStatus = 'RESERVED' | 'FULFILLED' | 'CANCELLED';

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  totalCents: number;
  lineCount: number;
  createdBy: string;
  createdAt: string;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  totalCents: number;
  lines: {
    productId: string;
    sku?: string;
    name?: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
  createdAt: string;
  updatedAt: string;
  allowedActions: { fulfil: boolean; cancel: boolean };
}

export type AlertStatus = 'OPEN' | 'RESOLVED';

export interface Alert {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  availableAtTrigger: number;
  threshold: number;
  status: AlertStatus;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
