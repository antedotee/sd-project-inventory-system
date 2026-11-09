import { InvalidCredentialsError, RateLimitedError } from '../domain/errors';
import type { User } from '../domain/user';
import type { Clock, PasswordHasher, RateLimiter } from './ports';
import type { Session, SessionRepository, UserRepository } from './repositories';

export interface AuthenticatedSession {
  user: User;
  session: Session;
  /** Set when the session was extended and the cookie must be re-issued. */
  renewed: boolean;
}

export interface LoginResult {
  token: string;
  user: User;
  expiresAt: Date;
}

/**
 * Session authentication (SRP: only authentication lives here).
 *
 * - The browser holds a random 32-byte token in an httpOnly cookie.
 * - The database stores only SHA-256(token). A leaked sessions table cannot
 *   be replayed as cookies.
 * - Sessions roll: if less than half the lifetime is left, extend it.
 * - The user is re-loaded on every request, so deactivation is immediate.
 */
export class AuthService {
  // A real hash so unknown emails take the same time as wrong passwords.
  private dummyHash: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly clock: Clock,
    private readonly sessionTtlMs: number,
  ) {
    this.dummyHash = hasher.hash('timing-equaliser-not-a-real-password');
  }

  async login(email: string, password: string, clientIp: string): Promise<LoginResult> {
    const limitKey = `${clientIp}|${email.toLowerCase()}`;
    const limit = this.limiter.hit(limitKey);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);

    const user = await this.users.findByEmail(email);
    const passwordOk = await this.hasher.verify(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !passwordOk || !user.active) throw new InvalidCredentialsError();

    this.limiter.reset(limitKey);
    const token = randomToken();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    await this.sessions.create({ id: hashToken(token), userId: user.id, expiresAt, createdAt: now });
    return { token, user, expiresAt };
  }

  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    const id = hashToken(token);
    const session = await this.sessions.findById(id);
    if (!session) return null;

    const now = this.clock.now();
    if (session.expiresAt <= now) {
      await this.sessions.delete(id);
      return null;
    }

    const user = await this.users.findById(session.userId);
    if (!user || !user.active) {
      await this.sessions.delete(id);
      return null;
    }

    const remaining = session.expiresAt.getTime() - now.getTime();
    if (remaining < this.sessionTtlMs / 2) {
      const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
      await this.sessions.extend(id, expiresAt);
      return { user, session: { ...session, expiresAt }, renewed: true };
    }
    return { user, session, renewed: false };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.delete(hashToken(token));
  }
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}
