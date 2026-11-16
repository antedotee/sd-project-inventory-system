import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../../src/infrastructure/db/schema';
import { call, loginAs, makeTestApp, resetDb, TEST_PASSWORD } from '../helpers';

const ctx = makeTestApp();
beforeEach(() => resetDb(ctx));

describe('session authentication over HTTP', () => {
  test('login sets an httpOnly SameSite=Lax cookie; /me returns the user without the hash', async () => {
    await ctx.container.services.users.create({ email: 'a@test.local', name: 'A', password: TEST_PASSWORD, role: 'STAFF' });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'A@test.local', password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const me = await call(ctx, 'GET', '/api/auth/me', { cookie: cookie.split(';')[0] });
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe('a@test.local');
    expect(me.json.user.passwordHash).toBeUndefined();
  });

  test('wrong password -> 401 INVALID_CREDENTIALS', async () => {
    await ctx.container.services.users.create({ email: 'b@test.local', name: 'B', password: TEST_PASSWORD, role: 'STAFF' });
    const res = await call(ctx, 'POST', '/api/auth/login', { body: { email: 'b@test.local', password: 'wrong-password' } });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('no cookie -> 401 on protected routes', async () => {
    expect((await call(ctx, 'GET', '/api/products')).status).toBe(401);
  });

  test('STAFF calling an ADMIN route -> 403', async () => {
    const { cookie } = await loginAs(ctx, 'STAFF');
    const res = await call(ctx, 'POST', '/api/users', {
      cookie,
      body: { email: 'x@test.local', name: 'X', password: TEST_PASSWORD, role: 'STAFF' },
    });
    expect(res.status).toBe(403);
  });

  test('ADMIN can create staff; duplicate email -> 409', async () => {
    const { cookie } = await loginAs(ctx, 'ADMIN');
    const body = { email: 'new@test.local', name: 'New', password: TEST_PASSWORD, role: 'STAFF' };
    expect((await call(ctx, 'POST', '/api/users', { cookie, body })).status).toBe(201);
    const dup = await call(ctx, 'POST', '/api/users', { cookie, body: { ...body, email: 'NEW@test.local' } });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('DUPLICATE');
  });

  test('a new login issues a new token and drops the old session', async () => {
    const { cookie: first, user } = await loginAs(ctx, 'STAFF');
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: first },
      body: JSON.stringify({ email: user.email, password: TEST_PASSWORD }),
    });
    const second = res.headers.get('set-cookie')!.split(';')[0]!;
    expect(second).not.toBe(first);
    expect((await call(ctx, 'GET', '/api/auth/me', { cookie: first })).status).toBe(401);
    expect((await call(ctx, 'GET', '/api/auth/me', { cookie: second })).status).toBe(200);
  });

  test('logout invalidates the session server-side', async () => {
    const { cookie } = await loginAs(ctx, 'STAFF');
    expect((await call(ctx, 'POST', '/api/auth/logout', { cookie })).status).toBe(204);
    expect((await call(ctx, 'GET', '/api/auth/me', { cookie })).status).toBe(401);
  });

  test('deactivating a user ends their existing session', async () => {
    const { cookie, user } = await loginAs(ctx, 'STAFF');
    await ctx.container.database.db.update(users).set({ active: false }).where(eq(users.id, user.id));
    expect((await call(ctx, 'GET', '/api/auth/me', { cookie })).status).toBe(401);
  });

  test('6th login attempt within a minute -> 429 with Retry-After', async () => {
    await ctx.container.services.users.create({ email: 'rl@test.local', name: 'R', password: TEST_PASSWORD, role: 'STAFF' });
    for (let i = 0; i < 5; i++) {
      await call(ctx, 'POST', '/api/auth/login', { body: { email: 'rl@test.local', password: 'wrong-password' } });
    }
    const res = await call(ctx, 'POST', '/api/auth/login', { body: { email: 'rl@test.local', password: TEST_PASSWORD } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('admin bootstrap creates the first admin once, then is a no-op', async () => {
    const svc = ctx.container.services.users;
    expect(await svc.bootstrapAdmin('boot@test.local', TEST_PASSWORD)).toBe('created');
    expect(await svc.bootstrapAdmin('other@test.local', TEST_PASSWORD)).toBe('skipped');
  });
});
