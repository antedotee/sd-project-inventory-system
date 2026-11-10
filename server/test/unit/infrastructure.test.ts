import { describe, expect, test } from 'bun:test';
import type { TransactionRunner, UnitOfWork } from '../../src/application/ports';
import { LowStockEvent } from '../../src/domain/events';
import { InProcessEventBus } from '../../src/infrastructure/event-bus';
import { SlidingWindowRateLimiter } from '../../src/infrastructure/security';
import { RetryingTransactionRunner } from '../../src/infrastructure/transaction/retrying-transaction-runner';

function pgFailure(code: string) {
  // Shape of a Drizzle-wrapped driver error: the SQLSTATE sits on `cause`.
  return Object.assign(new Error('query failed'), { cause: Object.assign(new Error('pg'), { code }) });
}

/** A fake runner that fails with the given codes before succeeding. */
function flakyRunner(failures: string[]): TransactionRunner & { attempts: number } {
  return {
    attempts: 0,
    async run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
      this.attempts++;
      const code = failures.shift();
      if (code) throw pgFailure(code);
      return work({} as UnitOfWork);
    },
  };
}

const noSleep = async () => {};

describe('RetryingTransactionRunner (Decorator)', () => {
  test('retries a deadlock and then succeeds', async () => {
    const inner = flakyRunner(['40P01']);
    const runner = new RetryingTransactionRunner(inner, { maxAttempts: 3, baseDelayMs: 1 }, noSleep);
    expect(await runner.run(async () => 'ok')).toBe('ok');
    expect(inner.attempts).toBe(2);
  });

  test('gives up after maxAttempts', async () => {
    const inner = flakyRunner(['40001', '40001', '40001', '40001']);
    const runner = new RetryingTransactionRunner(inner, { maxAttempts: 3, baseDelayMs: 1 }, noSleep);
    await expect(runner.run(async () => 'ok')).rejects.toThrow('query failed');
    expect(inner.attempts).toBe(3);
  });

  test('does not retry other errors', async () => {
    const inner = flakyRunner(['23505']);
    const runner = new RetryingTransactionRunner(inner, { maxAttempts: 3, baseDelayMs: 1 }, noSleep);
    await expect(runner.run(async () => 'ok')).rejects.toThrow();
    expect(inner.attempts).toBe(1);
  });
});

describe('InProcessEventBus (Observer)', () => {
  test('delivers to subscribers and isolates a failing listener', async () => {
    const errors: unknown[] = [];
    const bus = new InProcessEventBus({ error: (obj: unknown) => void errors.push(obj) } as never);
    const seen: string[] = [];
    bus.subscribe('LowStock', async () => {
      throw new Error('listener down');
    });
    bus.subscribe('LowStock', async (e) => void seen.push(e.productId));
    await bus.publish([new LowStockEvent('p1', 0, 5)]);
    expect(seen).toEqual(['p1']);
    expect(errors).toHaveLength(1);
  });
});

describe('SlidingWindowRateLimiter', () => {
  test('allows N hits per window, then blocks until the window slides', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(5, 60_000, { now: () => new Date(now) });
    for (let i = 0; i < 5; i++) expect(limiter.hit('k').allowed).toBe(true);
    const blocked = limiter.hit('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    now = 60_001;
    expect(limiter.hit('k').allowed).toBe(true);
  });
});
