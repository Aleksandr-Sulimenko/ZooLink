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

/** Market an event pertains to (ADR-0002 hard split), or null for market-agnostic events. */
export type EventMarket = 'pet' | 'livestock' | null;

/**
 * The required event envelope (event-catalog.md §1). These fields are stamped into the stored
 * `outbox_events.payload` JSONB alongside the domain fields by {@link OutboxService.publish}:
 * - `schemaVersion` — bump when a payload's shape changes, so consumers can branch on it;
 * - `occurredAt` — domain occurrence time (ISO-8601);
 * - `market` — pet/livestock (ADR-0002) or null.
 * Carrying them from the first capture means downstream analytics/consumers never have to back-fill.
 */
export interface OutboxPublishInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  /** Envelope: event schema version (event-catalog §1). */
  schemaVersion: number;
  /** Envelope: market (ADR-0002) or null for market-agnostic events. */
  market: EventMarket;
  /** Envelope: domain occurrence time; defaults to now() at publish if omitted. */
  occurredAt?: Date;
  /** Domain-specific fields, merged under the envelope in the stored payload. */
  payload: Record<string, unknown>;
}
