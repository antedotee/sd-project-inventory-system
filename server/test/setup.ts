// Preloaded once before any test file (bunfig.toml).
import { loadConfig } from '../src/config';
import { Database } from '../src/infrastructure/db/client';
import { runMigrations } from '../src/infrastructure/db/migrate';

const config = loadConfig();
if (!config.DATABASE_URL.endsWith('_test')) {
  throw new Error(`Refusing to run tests against ${config.DATABASE_URL}: it is not a *_test database`);
}
await runMigrations(Database.connect(config.DATABASE_URL, config.DB_POOL_SIZE));
