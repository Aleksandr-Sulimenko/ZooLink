import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OutboxPublishInput } from './outbox.types';

/**
 * Outbox writer. Always called with the caller's Prisma transaction client so the event row
 * commits atomically with the domain change (the whole point of the outbox pattern — no
 * "wrote the row but missed the event" gap). The worker relay handles delivery.
 */
@Injectable()
export class OutboxService {
  publish(tx: Prisma.TransactionClient, event: OutboxPublishInput): Promise<unknown> {
    // The stored payload is `{ envelope … , …domainFields }` (event-catalog §1). The envelope keys
    // are written first so a domain field can never shadow them; consumers read both from `payload`.
    const payload: Record<string, unknown> = {
      schemaVersion: event.schemaVersion,
      occurredAt: (event.occurredAt ?? new Date()).toISOString(),
      market: event.market,
      ...event.payload,
    };
    return tx.outbox_events.create({
      data: {
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        event_type: event.eventType,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
}
