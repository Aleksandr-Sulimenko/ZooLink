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
    return tx.outbox_events.create({
      data: {
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        event_type: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }
}
