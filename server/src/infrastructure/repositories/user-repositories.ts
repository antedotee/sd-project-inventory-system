import { count, eq, lte, sql } from 'drizzle-orm';
import type { Session, SessionRepository, UserRepository } from '../../application/repositories';
import { DuplicateError } from '../../domain/errors';
import type { User } from '../../domain/user';
import type { Executor } from '../db/client';
import { PG, pgError } from '../db/pg-errors';
import { sessions, users } from '../db/schema';
import { userMapper } from '../mappers';

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Executor) {}

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? userMapper.toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
    return row ? userMapper.toDomain(row) : null;
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users);
    return row?.n ?? 0;
  }

  async create(user: User): Promise<User> {
    try {
      const [row] = await this.db
        .insert(users)
        .values({
          id: user.id,
          email: user.email,
          name: user.name,
          passwordHash: user.passwordHash,
          role: user.role,
          active: user.active,
        })
        .returning();
      return userMapper.toDomain(row!);
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) {
        throw new DuplicateError('A user with this email already exists', { field: 'email' });
      }
      throw err;
    }
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Executor) {}

  async create(session: Session): Promise<void> {
    await this.db.insert(sessions).values(session);
  }

  async findById(id: string): Promise<Session | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id));
    return row ?? null;
  }

  async extend(id: string, expiresAt: Date): Promise<void> {
    await this.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteExpired(now: Date): Promise<number> {
    const rows = await this.db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id });
    return rows.length;
  }
}
