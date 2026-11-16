import { beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import {
  type AppError,
  DuplicateError,
  ForbiddenError,
  IdempotencyInProgressError,
  IdempotencyKeyMismatchError,
  InsufficientStockError,
  InvalidStateTransitionError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
  VersionConflictError,
} from '../../src/domain/errors';
import { createErrorHandler } from '../../src/http/error-handler';
import type { AppEnv } from '../../src/http/types';
import { call, makeTestApp, resetDb } from '../helpers';

const ctx = makeTestApp();
beforeAll(() => resetDb(ctx));

describe('health and routing', () => {
  test('GET /api/health checks the database', async () => {
    const res = await call(ctx, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: 'ok' });
  });

  test('every response carries a request id and security headers', async () => {
    const res = await call(ctx, 'GET', '/api/health');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  test('unknown API routes return the standard 404 shape', async () => {
    const res = await call(ctx, 'GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.json.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.json.error.requestId).toBeTruthy();
  });

  test('malformed JSON is a 400, not a 500', async () => {
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  test('a cross-site form post is rejected by the CSRF check', async () => {
    const res = await ctx.app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      body: 'x=1',
    });
    expect(res.status).toBe(403);
  });

  test('bodies over 64 KB are rejected', async () => {
    const res = await call(ctx, 'POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(70_000) } });
    expect(res.status).toBe(413);
    expect(res.json.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('error handler maps every error kind to one status', () => {
  const cases: [AppError | Error, number, string][] = [
    [new ValidationError('bad'), 400, 'VALIDATION_FAILED'],
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError('Thing', 1), 404, 'NOT_FOUND'],
    [new DuplicateError('dup'), 409, 'DUPLICATE'],
    [new VersionConflictError('Thing', '1'), 409, 'VERSION_CONFLICT'],
    [new InsufficientStockError({ productId: 'p', requested: 2, available: 1 }), 409, 'INSUFFICIENT_STOCK'],
    [new InvalidStateTransitionError('Order', 'A', 'B'), 409, 'INVALID_STATE_TRANSITION'],
    [new IdempotencyInProgressError(), 409, 'IDEMPOTENCY_IN_PROGRESS'],
    [new IdempotencyKeyMismatchError(), 422, 'IDEMPOTENCY_KEY_REUSED'],
    [new RateLimitedError(30), 429, 'RATE_LIMITED'],
    [Object.assign(new Error('x'), { cause: { code: '23505', constraint_name: 'products_sku_uq' } }), 409, 'DUPLICATE'],
    [Object.assign(new Error('x'), { cause: { code: '23514' } }), 409, 'CONSTRAINT_VIOLATION'],
    [new Error('boom: secret detail'), 500, 'INTERNAL'],
  ];

  for (const [error, status, code] of cases) {
    test(`${error.constructor.name} -> ${status} ${code}`, async () => {
      const app = new Hono<AppEnv>();
      app.use(async (c, next) => {
        c.set('requestId', 'req-1');
        await next();
      });
      app.get('/', () => {
        throw error;
      });
      app.onError(createErrorHandler(ctx.container.logger));
      const res = await app.request('/');
      const body = (await res.json()) as { error: { code: string; requestId: string } };
      expect(res.status).toBe(status);
      expect(body.error.code).toBe(code);
      expect(body.error.requestId).toBe('req-1');
      if (status === 500) expect(JSON.stringify(body)).not.toContain('secret detail');
      if (status === 429) expect(res.headers.get('retry-after')).toBe('30');
    });
  }
});
