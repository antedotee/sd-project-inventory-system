import { Hono } from 'hono';
import type { IdempotencyService } from '../../application/idempotency-service';
import type { OrderService } from '../../application/order-service';
import { requireAuth } from '../middleware/auth';
import { idempotent } from '../middleware/idempotency';
import { presentOrder } from '../presenters';
import { idParam, orderQuery, placeOrderBody } from '../schemas';
import { type AppEnv, currentUser } from '../types';
import { validate } from '../validation';

export function orderRoutes(orders: OrderService, idempotency: IdempotencyService) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', orderQuery), async (c) => {
      const { status, page, pageSize } = c.req.valid('query');
      return c.json(await orders.list({ status }, { page, pageSize }));
    })
    .get('/:id', validate('param', idParam), async (c) => {
      const { order, products } = await orders.get(c.req.valid('param').id);
      return c.json(presentOrder(order, products));
    })
    .post('/', idempotent(idempotency), validate('json', placeOrderBody), async (c) => {
      const order = await orders.place(c.req.valid('json'), currentUser(c).id);
      return c.json(presentOrder(order), 201);
    })
    .post('/:id/fulfil', validate('param', idParam), async (c) => {
      const order = await orders.fulfil(c.req.valid('param').id, currentUser(c).id);
      return c.json(presentOrder(order));
    })
    .post('/:id/cancel', validate('param', idParam), async (c) => {
      const order = await orders.cancel(c.req.valid('param').id);
      return c.json(presentOrder(order));
    });
}
