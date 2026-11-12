import { IdempotencyInProgressError, IdempotencyKeyMismatchError } from '../domain/errors';
import type { Clock } from './ports';
import type { IdempotencyRepository } from './repositories';

export type IdempotencyDecision =
  | { kind: 'execute' }
  | { kind: 'replay'; status: number; body: unknown };

/** A claim older than this is treated as a crashed request and can be taken over. */
const STALE_AFTER_MS = 60_000;

/**
 * Makes "create order" safe to retry. The client sends the same
 * Idempotency-Key when it retries; we run the request once and replay the
 * stored response afterwards.
 */
export class IdempotencyService {
  constructor(
    private readonly repo: IdempotencyRepository,
    private readonly clock: Clock,
  ) {}

  async begin(userId: string, key: string, requestHash: string): Promise<IdempotencyDecision> {
    const now = this.clock.now();
    const result = await this.repo.begin(userId, key, requestHash, now);
    if (result.kind === 'started') return { kind: 'execute' };

    const { record } = result;
    if (record.requestHash !== requestHash) throw new IdempotencyKeyMismatchError();
    if (record.status === 'DONE') {
      return { kind: 'replay', status: record.responseStatus!, body: record.responseBody };
    }
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
    if (await this.repo.reclaimStale(userId, key, staleBefore, now)) return { kind: 'execute' };
    throw new IdempotencyInProgressError();
  }

  complete(userId: string, key: string, status: number, body: unknown): Promise<void> {
    return this.repo.complete(userId, key, status, body);
  }

  /** Server errors are not stored, so the client can retry with the same key. */
  discard(userId: string, key: string): Promise<void> {
    return this.repo.discard(userId, key);
  }
}
