import type { LowStockEvent, StockReplenishedEvent } from '../domain/events';
import { NotFoundError } from '../domain/errors';
import { newId } from '../domain/id';
import type { AlertStatus, LowStockAlert } from '../domain/low-stock-alert';
import type { Page, PageRequest } from './pagination';
import type { Clock, EventBus } from './ports';
import type { AlertRepository, AlertView } from './repositories';

/**
 * OBSERVER: subscribes to stock events. Stock code does not know alerts
 * exist; adding e.g. an email notifier is another listener, no edits to
 * StockService or OrderService.
 */
export class LowStockAlertListener {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly clock: Clock,
  ) {}

  register(bus: EventBus): void {
    bus.subscribe('LowStock', (e) => this.onLowStock(e));
    bus.subscribe('StockReplenished', (e) => this.onReplenished(e));
  }

  async onLowStock(event: LowStockEvent): Promise<void> {
    await this.alerts.openIfNone({
      id: newId(),
      productId: event.productId,
      availableAtTrigger: event.available,
      threshold: event.threshold,
      status: 'OPEN',
      acknowledgedBy: null,
      acknowledgedAt: null,
      createdAt: this.clock.now(),
      resolvedAt: null,
    });
  }

  async onReplenished(event: StockReplenishedEvent): Promise<void> {
    await this.alerts.resolveOpen(event.productId, this.clock.now());
  }
}

export class AlertService {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly clock: Clock,
  ) {}

  list(filter: { status?: AlertStatus }, page: PageRequest): Promise<Page<AlertView>> {
    return this.alerts.list(filter, page);
  }

  countOpen(): Promise<number> {
    return this.alerts.countOpen();
  }

  async acknowledge(id: string, userId: string): Promise<LowStockAlert> {
    const alert = await this.alerts.acknowledge(id, userId, this.clock.now());
    if (!alert) throw new NotFoundError('Alert', id);
    return alert;
  }
}
