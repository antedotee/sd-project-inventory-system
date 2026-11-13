import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { IdempotencyService } from '../../application/idempotency-service';
import { ValidationError } from '../../domain/errors';
import { type AppEnv, currentUser } from '../types';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Requires an Idempotency-Key header and guarantees the wrapped handler runs
 * at most once per (user, key). Retries get the stored response, marked with
 * `Idempotent-Replayed: true`.
 */
export function idempotent(service: IdempotencyService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header('Idempotency-Key');
    if (!key || !KEY_PATTERN.test(key)) {
      throw new ValidationError('An Idempotency-Key header is required (8-128 letters, digits, "-" or "_")', {
        location: 'header',
        fields: [{ path: 'Idempotency-Key', message: 'Required' }],
      });
    }
    const user = currentUser(c);
    const body = await c.req.text(); // Hono caches it, so the validator can still read the JSON
    const requestHash = new Bun.CryptoHasher('sha256').update(`${c.req.method} ${c.req.path}\n${body}`).digest('hex');

    const decision = await service.begin(user.id, key, requestHash);
    if (decision.kind === 'replay') {
      c.header('Idempotent-Replayed', 'true');
      return c.json(decision.body as object, decision.status as ContentfulStatusCode);
    }

    try {
      await next();
    } catch (err) {
      await service.discard(user.id, key);
      throw err;
    }

    if (c.res.status >= 500) {
      await service.discard(user.id, key); // let the client retry a server failure
    } else {
      const stored = await c.res.clone().json().catch(() => null);
      await service.complete(user.id, key, c.res.status, stored);
    }
  };
}
