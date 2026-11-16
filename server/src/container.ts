/**
 * COMPOSITION ROOT. The only file that knows concrete classes. Everything
 * else depends on interfaces and receives its collaborators through its
 * constructor (Dependency Inversion).
 */
import type { Logger } from 'pino';
import { AlertService, LowStockAlertListener } from './application/alerts';
import { AuthService } from './application/auth-service';
import { CategoryService, ProductService } from './application/catalog-service';
import { IdempotencyService } from './application/idempotency-service';
import { OrderService } from './application/order-service';
import { type Clock, type RateLimiter, systemClock } from './application/ports';
import type { IdempotencyRepository, SessionRepository } from './application/repositories';
import { StockService } from './application/stock-service';
import { UserService } from './application/user-service';
import type { Config } from './config';
import { Database } from './infrastructure/db/client';
import { InProcessEventBus } from './infrastructure/event-bus';
import { createLogger } from './infrastructure/logger';
import { DrizzleAlertRepository } from './infrastructure/repositories/alert-repositories';
import { DrizzleCategoryRepository, DrizzleProductRepository } from './infrastructure/repositories/catalog-repositories';
import { DrizzleIdempotencyRepository } from './infrastructure/repositories/idempotency-repository';
import { DrizzleOrderRepository } from './infrastructure/repositories/order-repositories';
import { DrizzleStockLevelRepository, DrizzleStockMovementRepository } from './infrastructure/repositories/stock-repositories';
import { DrizzleSessionRepository, DrizzleUserRepository } from './infrastructure/repositories/user-repositories';
import { BunPasswordHasher, SlidingWindowRateLimiter } from './infrastructure/security';
import { DrizzleTransactionRunner } from './infrastructure/transaction/drizzle-transaction-runner';
import { RetryingTransactionRunner } from './infrastructure/transaction/retrying-transaction-runner';

export interface Container {
  config: Config;
  logger: Logger;
  database: Database;
  services: {
    auth: AuthService;
    users: UserService;
    categories: CategoryService;
    products: ProductService;
    stock: StockService;
    orders: OrderService;
    alerts: AlertService;
    idempotency: IdempotencyService;
  };
  /** Repositories used by background housekeeping in main.ts. */
  housekeeping: { sessions: SessionRepository; idempotency: IdempotencyRepository };
}

export interface ContainerOverrides {
  clock?: Clock;
  loginLimiter?: RateLimiter;
  logger?: Logger;
}

export function buildContainer(config: Config, overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? createLogger(config.LOG_LEVEL);
  const clock = overrides.clock ?? systemClock;
  const database = Database.connect(config.DATABASE_URL, config.DB_POOL_SIZE);
  const db = database.db;

  // Repositories bound to the connection pool (for reads outside transactions).
  const users = new DrizzleUserRepository(db);
  const sessions = new DrizzleSessionRepository(db);
  const categories = new DrizzleCategoryRepository(db);
  const products = new DrizzleProductRepository(db);
  const stockLevels = new DrizzleStockLevelRepository(db);
  const movements = new DrizzleStockMovementRepository(db);
  const orders = new DrizzleOrderRepository(db);
  const alerts = new DrizzleAlertRepository(db);
  const idempotency = new DrizzleIdempotencyRepository(db);

  // Observer wiring.
  const bus = new InProcessEventBus(logger);
  new LowStockAlertListener(alerts, clock).register(bus);

  // Decorator wiring: services get a runner that retries deadlocks transparently.
  const tx = new RetryingTransactionRunner(new DrizzleTransactionRunner(db, bus));

  const hasher = new BunPasswordHasher();
  const loginLimiter = overrides.loginLimiter ?? new SlidingWindowRateLimiter(5, 60_000, clock);
  const sessionTtlMs = config.SESSION_TTL_HOURS * 3_600_000;

  return {
    config,
    logger,
    database,
    services: {
      auth: new AuthService(users, sessions, hasher, loginLimiter, clock, sessionTtlMs),
      users: new UserService(users, hasher),
      categories: new CategoryService(categories),
      products: new ProductService(products, categories, tx),
      stock: new StockService(tx, stockLevels, movements),
      orders: new OrderService(tx, orders, products),
      alerts: new AlertService(alerts, clock),
      idempotency: new IdempotencyService(idempotency, clock),
    },
    housekeeping: { sessions, idempotency },
  };
}
