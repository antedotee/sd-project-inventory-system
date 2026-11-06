import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either the pool or an open transaction. Repositories accept both. */
export type Executor = Db | Tx;

/**
 * SINGLETON: one connection pool per process. Creating a pool per request
 * (or per repository) would quickly exhaust Postgres' connection limit.
 */
export class Database {
  private static instance: Database | null = null;

  private constructor(
    readonly sql: Sql,
    readonly db: Db,
  ) {}

  static connect(url: string, poolSize: number): Database {
    if (!Database.instance) {
      const client = postgres(url, { max: poolSize, onnotice: () => {} });
      Database.instance = new Database(client, drizzle(client, { schema }));
    }
    return Database.instance;
  }

  async ping(): Promise<void> {
    await this.sql`select 1`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
    Database.instance = null;
  }
}
