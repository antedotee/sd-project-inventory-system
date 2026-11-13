/**
 * Request schemas (zod). They validate shape and basic ranges at the HTTP
 * boundary; business rules (e.g. "enough stock") stay in the domain.
 */
import { z } from 'zod';
import { ROLES } from '../domain/user';
import { ORDER_STATUSES } from '../domain/order';
import { ALERT_STATUSES } from '../domain/low-stock-alert';

const MAX_QTY = 1_000_000;

export const idParam = z.object({ id: z.uuid() });
export const productIdParam = z.object({ productId: z.uuid() });

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const loginBody = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const createUserBody = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12, 'Use at least 12 characters').max(200),
  role: z.enum(ROLES),
});

export const categoryBody = z.object({ name: z.string().trim().min(1).max(60) });

export const reorderPolicyBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FIXED'), reorderPoint: z.number().int().min(0).max(MAX_QTY) }),
  z.object({
    kind: z.literal('PERCENT_OF_MAX'),
    maxStock: z.number().int().min(1).max(MAX_QTY),
    percent: z.number().int().min(1).max(100),
  }),
]);

export const createProductBody = z.object({
  sku: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  categoryId: z.uuid().nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
  reorderPolicy: reorderPolicyBody,
});

export const updateProductBody = createProductBody
  .omit({ sku: true })
  .partial()
  .extend({ version: z.number().int().min(1) })
  .refine((b) => Object.keys(b).length > 1, { message: 'Nothing to update' });

export const productQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
});

export const stockQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  lowOnly: booleanQuery.optional(),
});

export const receiptBody = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_QTY),
  note: z.string().trim().max(500).optional(),
});

export const adjustmentBody = z.object({
  productId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-MAX_QTY)
    .max(MAX_QTY)
    .refine((n) => n !== 0, 'Delta cannot be zero'),
  reason: z.string().trim().min(3).max(500),
});

export const placeOrderBody = z.object({
  lines: z
    .array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(50),
});

export const orderQuery = pageQuery.extend({ status: z.enum(ORDER_STATUSES).optional() });
export const alertQuery = pageQuery.extend({ status: z.enum(ALERT_STATUSES).optional() });
