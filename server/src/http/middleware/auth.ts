import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AuthService } from '../../application/auth-service';
import { ForbiddenError, UnauthenticatedError } from '../../domain/errors';
import type { Role } from '../../domain/user';
import type { AppEnv } from '../types';

export interface CookieSettings {
  name: string;
  secure: boolean;
}

/**
 * In production the cookie uses the `__Host-` prefix: browsers then insist
 * on Secure, Path=/ and no Domain, so subdomains cannot overwrite it.
 */
export function cookieSettings(production: boolean): CookieSettings {
  return production ? { name: '__Host-sp_session', secure: true } : { name: 'sp_session', secure: false };
}

export function setSessionCookie(c: Context, settings: CookieSettings, token: string, expiresAt: Date) {
  setCookie(c, settings.name, token, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context, settings: CookieSettings) {
  deleteCookie(c, settings.name, { path: '/', secure: settings.secure });
}

export function readSessionToken(c: Context, settings: CookieSettings): string | undefined {
  return getCookie(c, settings.name);
}

/** Resolves the cookie to a user (or null). Never rejects by itself. */
export function loadSession(auth: AuthService, settings: CookieSettings): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', null);
    const token = readSessionToken(c, settings);
    if (token) {
      const result = await auth.authenticate(token);
      if (result) {
        c.set('user', result.user);
        if (result.renewed) setSessionCookie(c, settings, token, result.session.expiresAt);
      } else {
        clearSessionCookie(c, settings);
      }
    }
    await next();
  };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw new UnauthenticatedError();
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) throw new UnauthenticatedError();
    if (!user.hasRole(...roles)) throw new ForbiddenError();
    await next();
  };
}
