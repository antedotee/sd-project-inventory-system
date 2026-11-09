import { beforeEach, describe, expect, test } from 'bun:test';
import { AuthService, hashToken } from '../../src/application/auth-service';
import { UserService } from '../../src/application/user-service';
import { InvalidCredentialsError, RateLimitedError } from '../../src/domain/errors';
import { User } from '../../src/domain/user';
import { InMemorySessionRepository, InMemoryUserRepository } from '../../src/infrastructure/memory/in-memory-repositories';
import { BunPasswordHasher, SlidingWindowRateLimiter } from '../../src/infrastructure/security';

const HOUR = 3_600_000;

/** AuthService tested entirely with in-memory adapters: no database needed. */
describe('AuthService', () => {
  let now: number;
  let users: InMemoryUserRepository;
  let sessions: InMemorySessionRepository;
  let auth: AuthService;
  const clock = { now: () => new Date(now) };

  beforeEach(async () => {
    now = Date.UTC(2026, 0, 1);
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
    const hasher = new BunPasswordHasher();
    auth = new AuthService(users, sessions, hasher, new SlidingWindowRateLimiter(5, 60_000, clock), clock, 8 * HOUR);
    await new UserService(users, hasher).create({
      email: 'Staff@Example.com',
      name: 'Sam',
      password: 'a-long-password',
      role: 'STAFF',
    });
  });

  test('stores only the hash of the token', async () => {
    const { token } = await auth.login('staff@example.com', 'a-long-password', 'ip');
    expect(sessions.rows.has(token)).toBe(false);
    expect(sessions.rows.has(hashToken(token))).toBe(true);
  });

  test('each login issues a new token', async () => {
    const a = await auth.login('staff@example.com', 'a-long-password', 'ip');
    const b = await auth.login('staff@example.com', 'a-long-password', 'ip');
    expect(a.token).not.toBe(b.token);
  });

  test('wrong password and unknown email fail the same way', async () => {
    await expect(auth.login('staff@example.com', 'nope', 'ip')).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(auth.login('ghost@example.com', 'nope', 'ip')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('expired sessions are rejected and removed', async () => {
    const { token } = await auth.login('staff@example.com', 'a-long-password', 'ip');
    now += 8 * HOUR + 1;
    expect(await auth.authenticate(token)).toBeNull();
    expect(sessions.rows.size).toBe(0);
  });

  test('sessions roll forward once past half their lifetime', async () => {
    const { token, expiresAt } = await auth.login('staff@example.com', 'a-long-password', 'ip');
    now += HOUR;
    expect((await auth.authenticate(token))?.renewed).toBe(false);
    now += 4 * HOUR;
    const renewed = await auth.authenticate(token);
    expect(renewed?.renewed).toBe(true);
    expect(renewed!.session.expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime());
  });

  test('a deactivated user loses access immediately', async () => {
    const { token, user } = await auth.login('staff@example.com', 'a-long-password', 'ip');
    const inactive = new User(user.id, user.email, user.name, user.passwordHash, user.role, false, user.createdAt);
    users.rows.set(user.id, inactive);
    expect(await auth.authenticate(token)).toBeNull();
  });

  test('the 6th failed attempt within a minute is rate limited', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(auth.login('staff@example.com', 'wrong', 'ip')).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(auth.login('staff@example.com', 'a-long-password', 'ip')).rejects.toBeInstanceOf(RateLimitedError);
  });
});
