import { Hono } from 'hono';
import type { AlertService } from '../../application/alerts';
import { requireAuth } from '../middleware/auth';
import { alertQuery, idParam } from '../schemas';
import { type AppEnv, currentUser } from '../types';
import { validate } from '../validation';

export function alertRoutes(alerts: AlertService) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', alertQuery), async (c) => {
      const { status, page, pageSize } = c.req.valid('query');
      return c.json(await alerts.list({ status }, { page, pageSize }));
    })
    .get('/open-count', async (c) => c.json({ open: await alerts.countOpen() }))
    .post('/:id/acknowledge', validate('param', idParam), async (c) => {
      return c.json(await alerts.acknowledge(c.req.valid('param').id, currentUser(c).id));
    });
}
