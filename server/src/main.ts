import { loadConfig } from './config';
import { buildContainer } from './container';
import { createApp } from './http/app';
import { runMigrations } from './infrastructure/db/migrate';

const config = loadConfig();
const container = buildContainer(config);
const { logger, database, services, housekeeping } = container;

await runMigrations(database);
const bootstrap = await services.users.bootstrapAdmin(config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
if (bootstrap === 'created') logger.info({ email: config.ADMIN_EMAIL }, 'created first admin user');

const app = createApp(container);
const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
logger.info({ port: server.port, env: config.NODE_ENV }, 'StockPilot API listening');

// Housekeeping: drop expired sessions.
const housekeepingTimer = setInterval(async () => {
  try {
    const sessions = await housekeeping.sessions.deleteExpired(new Date());
    if (sessions) logger.info({ sessions }, 'housekeeping removed expired sessions');
  } catch (err) {
    logger.error({ err }, 'housekeeping failed');
  }
}, 15 * 60_000);

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish, then close the database pool.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  clearInterval(housekeepingTimer);
  await server.stop(false);
  await database.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
