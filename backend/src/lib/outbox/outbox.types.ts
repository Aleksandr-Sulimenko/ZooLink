/**
 * Transactional-outbox contracts (ADR-0009: no message broker in the MVP). Domains write an
 * event row in the *same* DB transaction as their state change; the worker relay delivers it
 * at-least-once to registered consumers. Event names follow `event-catalog.md`.
 */
export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  /** Delivery attempt number for this event (>=1 when handed to a consumer). */
  attempts: number;
}

export interface OutboxConsumer {
  /** Event types this consumer handles, or `'*'` for all. */
  readonly eventTypes: readonly string[] | '*';
  /** MUST be idempotent — delivery is at-least-once, so the same event may arrive again. */
  handle(event: OutboxEvent): Promise<void>;
}

/**
 * DI token for the consumer set. Domain modules (Phase 2) contribute consumers by providing
 * an array under this token; the relay injects it `@Optional()` (empty when none registered).
 */
export const OUTBOX_CONSUMERS = Symbol('OUTBOX_CONSUMERS');

export interface OutboxPublishInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
