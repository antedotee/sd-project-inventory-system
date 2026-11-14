import { Hono } from 'hono';
import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import type { AuthService } from '../../application/auth-service';
import type { UserService } from '../../application/user-service';
import {
  type CookieSettings,
  clearSessionCookie,
  readSessionToken,
  requireAuth,
  requireRole,
  setSessionCookie,
} from '../middleware/auth';
import { createUserBody, loginBody } from '../schemas';
import { type AppEnv, currentUser } from '../types';
import { validate } from '../validation';

function clientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // e.g. in-process test requests have no socket
  }
}

/** Controller for /api/auth: parse request, call AuthService, shape response. */
export function authRoutes(auth: AuthService, cookie: CookieSettings) {
  return new Hono<AppEnv>()
    .post('/login', validate('json', loginBody), async (c) => {
      const { email, password } = c.req.valid('json');
      // Drop any previous session first: a login always issues a fresh token
      // (prevents session fixation).
      const previous = readSessionToken(c, cookie);
      if (previous) await auth.logout(previous);

      const { token, user, expiresAt } = await auth.login(email, password, clientIp(c));
      setSessionCookie(c, cookie, token, expiresAt);
      return c.json({ user: user.toPublic() });
    })
    .post('/logout', async (c) => {
      const token = readSessionToken(c, cookie);
      if (token) await auth.logout(token);
      clearSessionCookie(c, cookie);
      return c.body(null, 204);
    })
    .get('/me', requireAuth, (c) => c.json({ user: currentUser(c).toPublic() }));
}

export function userRoutes(users: UserService) {
  return new Hono<AppEnv>().post('/', requireRole('ADMIN'), validate('json', createUserBody), async (c) => {
    const user = await users.create(c.req.valid('json'));
    return c.json({ user: user.toPublic() }, 201);
  });
}
