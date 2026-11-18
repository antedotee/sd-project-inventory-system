import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from 'hono/bun';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Container } from '../container';
import { NotFoundError } from '../domain/errors';
import { createErrorHandler } from './error-handler';
import { cookieSettings, loadSession } from './middleware/auth';
import { alertRoutes } from './routes/alert-routes';
import { authRoutes, userRoutes } from './routes/auth-routes';
import { categoryRoutes, productRoutes } from './routes/catalog-routes';
import { orderRoutes } from './routes/order-routes';
import { stockRoutes } from './routes/stock-routes';
import type { AppEnv } from './types';

/**
 * Builds the HTTP application. Layers: middleware -> routes (controllers)
 * -> services -> repositories. Routes receive only the services they use.
 */
export function createApp(container: Container) {
  const { config, logger, services, database } = container;
  const cookie = cookieSettings(config.NODE_ENV === 'production');
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    const entry = {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    };
    if (c.req.path === '/api/health') logger.debug(entry, 'request');
    else logger.info(entry, 'request');
  });

  const api = new Hono<AppEnv>();
  // Rejects cross-site form posts (Origin / Sec-Fetch-Site check). JSON posts
  // cannot be sent cross-site without a CORS preflight, which we never allow.
  api.use(csrf({ origin: config.APP_ORIGIN }));
  api.use(
    bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new HTTPException(413, { message: 'Request body is too large' });
      },
    }),
  );

  api.get('/health', async (c) => {
    await database.ping();
    return c.json({ status: 'ok' });
  });

  api.use(loadSession(services.auth, cookie));
  api.route('/auth', authRoutes(services.auth, cookie));
  api.route('/users', userRoutes(services.users));
  api.route('/categories', categoryRoutes(services.categories));
  api.route('/products', productRoutes(services.products));
  api.route('/stock', stockRoutes(services.stock));
  api.route('/orders', orderRoutes(services.orders));
  api.route('/alerts', alertRoutes(services.alerts));
  api.all('*', (c) => {
    throw new NotFoundError('Route', `${c.req.method} ${c.req.path}`);
  });

  app.route('/api', api);

  // Production: serve the built React app from the same origin, so the
  // session cookie needs no CORS. Hashed assets are cached forever.
  if (config.STATIC_DIR) {
    const root = config.STATIC_DIR;
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.get('*', serveStatic({ root }));
    app.get('*', serveStatic({ path: `${root}/index.html` })); // SPA fallback
  }

  app.onError(createErrorHandler(logger));
  return app;
}
