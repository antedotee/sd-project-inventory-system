import { Hono } from 'hono';
import type { CategoryService, ProductService } from '../../application/catalog-service';
import { requireAuth, requireRole } from '../middleware/auth';
import { presentPage, presentProduct } from '../presenters';
import { categoryBody, createProductBody, idParam, productQuery, updateProductBody } from '../schemas';
import type { AppEnv } from '../types';
import { validate } from '../validation';

export function categoryRoutes(categories: CategoryService) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', async (c) => c.json({ items: await categories.list() }))
    .post('/', requireRole('ADMIN'), validate('json', categoryBody), async (c) => {
      const category = await categories.create(c.req.valid('json').name);
      return c.json(category, 201);
    });
}

export function productRoutes(products: ProductService) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', validate('query', productQuery), async (c) => {
      const { q, categoryId, page, pageSize } = c.req.valid('query');
      const result = await products.search({ q, categoryId }, { page, pageSize });
      return c.json(presentPage(result, presentProduct));
    })
    .get('/:id', validate('param', idParam), async (c) => {
      return c.json(presentProduct(await products.get(c.req.valid('param').id)));
    })
    .post('/', requireRole('ADMIN'), validate('json', createProductBody), async (c) => {
      const product = await products.create(c.req.valid('json'));
      return c.json(presentProduct(product), 201);
    })
    .patch('/:id', requireRole('ADMIN'), validate('param', idParam), validate('json', updateProductBody), async (c) => {
      const { version, ...patch } = c.req.valid('json');
      const product = await products.update(c.req.valid('param').id, patch, version);
      return c.json(presentProduct(product));
    })
    .delete('/:id', requireRole('ADMIN'), validate('param', idParam), async (c) => {
      const product = await products.deactivate(c.req.valid('param').id);
      return c.json(presentProduct(product));
    });
}
