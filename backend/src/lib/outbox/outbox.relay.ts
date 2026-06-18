import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { backoffSeconds, MAX_ATTEMPTS } from './backoff';
import { OUTBOX_CONSUMERS, type OutboxConsumer, type OutboxEvent } from './outbox.types';

interface ClaimedRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
}

const BATCH_SIZE = 20;
const LEASE_SECONDS = 60; // visibility timeout: a crashed worker's events reappear after this
const POLL_INTERVAL_MS = 2000;
const MAX_ERROR_LEN = 1000;

/**
 * Worker-side outbox relay. Each tick atomically claims a batch of due events (incrementing
 * `attempts` and leasing them via `next_attempt_at` so processing happens outside the row lock),
 * dispatches to matching consumers, then marks each event done / scheduled-for-retry (exponential
 * backoff) / dead-lettered (after {@link MAX_ATTEMPTS}). Delivery is at-least-once; consumers
 * must be idempotent. Registered only in the worker context (OutboxRelayModule).
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(OUTBOX_CONSUMERS) private readonly consumers: OutboxConsumer[] = [],
  ) {}

  onModuleInit(): void {
    if (this.config.isTest) return; // tests drive tick() directly
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref(); // never keep the worker process alive just for polling
    this.logger.log(
      `Outbox relay started (poll ${POLL_INTERVAL_MS}ms, ${this.consumers.length} consumer(s))`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One relay pass. Non-reentrant; returns the number of events claimed this tick. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimed = await this.claim();
      for (const row of claimed) {
        await this.dispatch(row);
      }
      return claimed.length;
    } catch (err) {
      this.logger.error(
        `Outbox relay tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private claim(): Promise<ClaimedRow[]> {
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events o
      SET attempts = o.attempts + 1,
          next_attempt_at = NOW() + make_interval(secs => ${LEASE_SECONDS})
      WHERE o.id IN (
        SELECT id FROM outbox_events
        WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= NOW()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
      )
      RETURNING o.id, o.aggregate_type, o.aggregate_id, o.event_type, o.payload, o.attempts`;
  }

  private async dispatch(row: ClaimedRow): Promise<void> {
    const event: OutboxEvent = {
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      attempts: row.attempts,
    };
    const matched = this.consumers.filter(
      (c) => c.eventTypes === '*' || c.eventTypes.includes(event.eventType),
    );

    try {
      for (const consumer of matched) {
        await consumer.handle(event);
      }
      await this.prisma.outbox_events.update({
        where: { id: row.id },
        data: { processed_at: new Date(), last_error: null },
      });
      if (matched.length === 0) {
        this.logger.debug(`No consumer for ${event.eventType} (#${row.id}) — marked processed`);
      }
    } catch (err) {
      await this.onFailure(row, err);
    }
  }

  private async onFailure(row: ClaimedRow, err: unknown): Promise<void> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LEN);

    if (row.attempts >= MAX_ATTEMPTS) {
      await this.prisma.outbox_events.update({
        where: { id: row.id },
        data: { last_error: message, dead_lettered_at: new Date() },
      });
      this.logger.error(
        `Outbox event ${row.id} (${row.event_type}) dead-lettered after ${row.attempts} attempts: ${message}`,
      );
      return;
    }

    const delay = backoffSeconds(row.attempts);
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET last_error = ${message}, next_attempt_at = NOW() + make_interval(secs => ${delay})
      WHERE id = ${row.id}::uuid`;
    this.logger.warn(
      `Outbox event ${row.id} (${row.event_type}) failed (attempt ${row.attempts}), retry in ${delay}s: ${message}`,
    );
  }
}
