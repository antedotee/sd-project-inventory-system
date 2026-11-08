import type { Clock, PasswordHasher, RateLimiter, RateLimitResult } from '../application/ports';

/** argon2id via Bun's built-in implementation (no native module to install). */
export class BunPasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return Bun.password.hash(plain, { algorithm: 'argon2id' });
  }
  verify(plain: string, hash: string): Promise<boolean> {
    return Bun.password.verify(plain, hash);
  }
}

/**
 * Sliding-window limiter kept in memory. Good for a single instance; a
 * multi-instance deployment would implement RateLimiter on Redis/Postgres.
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  hit(key: string): RateLimitResult {
    const now = this.clock.now().getTime();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const retryAfterMs = this.windowMs - (now - recent[0]!);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
