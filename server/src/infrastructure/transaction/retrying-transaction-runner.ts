import type { TransactionRunner, UnitOfWork } from '../../application/ports';
import { PG, pgError } from '../db/pg-errors';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

export type Sleep = (ms: number) => Promise<void>;

const RETRYABLE: ReadonlySet<string> = new Set([PG.DEADLOCK_DETECTED, PG.SERIALIZATION_FAILURE]);

/**
 * DECORATOR: wraps any TransactionRunner and adds retries for transient
 * Postgres failures (deadlock, serialization failure). Services are
 * unchanged; container.ts decides whether to wrap.
 *
 * Retrying is safe because a failed transaction rolled back completely, and
 * each attempt gets a fresh UnitOfWork (and a fresh event buffer).
 */
export class RetryingTransactionRunner implements TransactionRunner {
  constructor(
    private readonly inner: TransactionRunner,
    private readonly options: RetryOptions = { maxAttempts: 3, baseDelayMs: 20 },
    private readonly sleep: Sleep = (ms) => Bun.sleep(ms),
  ) {}

  async run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.inner.run(work);
      } catch (err) {
        const code = pgError(err)?.code;
        if (!code || !RETRYABLE.has(code) || attempt >= this.options.maxAttempts) throw err;
        // Exponential backoff with full jitter so retries do not collide again.
        const cap = this.options.baseDelayMs * 2 ** (attempt - 1);
        await this.sleep(Math.random() * cap);
      }
    }
  }
}
