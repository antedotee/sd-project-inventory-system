import { Hono } from 'hono';
import type { StockService } from '../../application/stock-service';
import { requireAuth, requireRole } from '../middleware/auth';
import { presentMovement, presentPage } from '../presenters';
import { adjustmentBody, pageQuery, productIdParam, receiptBody, stockQuery } from '../schemas';
import { type AppEnv, currentUser } from '../types';
import { validate } from '../validation';

export function stockRoutes(stock: StockService) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', stockQuery), async (c) => {
      const { q, lowOnly, page, pageSize } = c.req.valid('query');
      return c.json(await stock.list({ q, lowOnly }, { page, pageSize }));
    })
    .get('/:productId/movements', validate('param', productIdParam), validate('query', pageQuery), async (c) => {
      const result = await stock.history(c.req.valid('param').productId, c.req.valid('query'));
      return c.json(presentPage(result, presentMovement));
    })
    .post('/receipts', validate('json', receiptBody), async (c) => {
      const { productId, quantity, note } = c.req.valid('json');
      return c.json(await stock.receive(productId, quantity, note ?? null, currentUser(c).id), 201);
    })
    .post('/adjustments', requireRole('ADMIN'), validate('json', adjustmentBody), async (c) => {
      const { productId, delta, reason } = c.req.valid('json');
      return c.json(await stock.adjust(productId, delta, reason, currentUser(c).id), 201);
    });
}
