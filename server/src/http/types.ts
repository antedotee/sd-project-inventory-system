import type { User } from '../domain/user';

/** Values attached to each request by middleware. */
export interface AppEnv {
  Variables: {
    requestId: string;
    user: User | null;
  };
}

/** For routes behind requireAuth: the user is guaranteed to be set. */
export function currentUser(c: { get(key: 'user'): User | null }): User {
  const user = c.get('user');
  if (!user) throw new Error('currentUser() used on a route without requireAuth');
  return user;
}
