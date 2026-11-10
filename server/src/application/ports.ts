/**
 * Ports: abstractions the application needs from the outside world.
 * Concrete adapters are chosen in container.ts.
 */
import type { DomainEvent, DomainEventName } from '../domain/events';
import type {
  OrderRepository,
  ProductRepository,
  StockLevelReader,
  StockLevelWriter,
  StockMovementRepository,
} from './repositories';

/**
 * UNIT OF WORK: repositories bound to one database transaction, plus a
 * buffer for domain events that are published only after commit.
 */
export interface UnitOfWork {
  products: ProductRepository;
  stockLevels: StockLevelReader & StockLevelWriter;
  movements: StockMovementRepository;
  orders: OrderRepository;
  record(event: DomainEvent): void;
}

export interface TransactionRunner {
  /** Runs `work` in one transaction: all of it commits, or none of it does. */
  run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void>;

export interface EventBus {
  subscribe<N extends DomainEventName>(name: N, handler: EventHandler<Extract<DomainEvent, { name: N }>>): void;
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitResult;
  reset(key: string): void;
}

export const systemClock: Clock = { now: () => new Date() };
