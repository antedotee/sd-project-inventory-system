import { and, eq, lt } from 'drizzle-orm';
import type { BeginResult, IdempotencyRepository } from '../../application/repositories';
import type { Executor } from '../db/client';
import { idempotencyKeys } from '../db/schema';

export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: Executor) {}

  async begin(userId: string, key: string, requestHash: string, now: Date): Promise<BeginResult> {
    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({ userId, key, requestHash, status: 'IN_PROGRESS', createdAt: now })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (inserted.length === 1) return { kind: 'started' };

    const [record] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    // The row can vanish between the two statements if the first request
    // failed and discarded it; claiming again is then correct.
    if (!record) return this.begin(userId, key, requestHash, now);
    return { kind: 'existing', record };
  }

  async reclaimStale(userId: string, key: string, staleBefore: Date, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(idempotencyKeys)
      .set({ createdAt: now })
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.status, 'IN_PROGRESS'),
          lt(idempotencyKeys.createdAt, staleBefore),
        ),
      )
      .returning({ key: idempotencyKeys.key });
    return rows.length === 1;
  }

  async complete(userId: string, key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ status: 'DONE', responseStatus, responseBody })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  }

  async discard(userId: string, key: string): Promise<void> {
    await this.db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, cutoff))
      .returning({ key: idempotencyKeys.key });
    return rows.length;
  }
}
