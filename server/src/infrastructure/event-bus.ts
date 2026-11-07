import type { Logger } from 'pino';
import type { EventBus, EventHandler } from '../application/ports';
import type { DomainEvent, DomainEventName } from '../domain/events';

/**
 * OBSERVER: subjects publish events, listeners subscribe by event name.
 *
 * In-process and synchronous after commit. A failing listener is logged and
 * does not affect the request that already committed, nor other listeners.
 * (A multi-instance deployment would swap this for an outbox table or a
 * queue behind the same EventBus interface.)
 */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<DomainEventName, EventHandler<never>[]>();

  constructor(private readonly logger: Pick<Logger, 'error'>) {}

  subscribe<N extends DomainEventName>(name: N, handler: EventHandler<Extract<DomainEvent, { name: N }>>): void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as EventHandler<never>);
    this.handlers.set(name, list);
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const handler of this.handlers.get(event.name) ?? []) {
        try {
          await (handler as EventHandler<DomainEvent>)(event);
        } catch (err) {
          this.logger.error({ err, event: event.name }, 'event listener failed');
        }
      }
    }
  }
}
