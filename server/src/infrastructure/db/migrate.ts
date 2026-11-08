import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadConfig } from '../../config';
import { Database } from './client';

const MIGRATIONS_DIR = new URL('../../../drizzle', import.meta.url).pathname;

/** Applies pending migrations. Safe to run on every start (already-applied ones are skipped). */
export async function runMigrations(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder: MIGRATIONS_DIR });
}

if (import.meta.main) {
  const config = loadConfig();
  const database = Database.connect(config.DATABASE_URL, 1);
  await runMigrations(database);
  await database.close();
  console.log('Migrations applied');
}
