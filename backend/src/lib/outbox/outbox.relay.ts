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
 * Worker-side outbox relay. Each tick atomically LEASES a batch of due events (moving
 * `next_attempt_at` forward so processing happens outside the row lock and a crashed worker's events
 * reappear after the lease), dispatches to matching consumers, then marks each event done /
 * scheduled-for-retry (exponential backoff) / dead-lettered (after {@link MAX_ATTEMPTS}).
 *
 * `attempts` counts REAL delivery attempts — it is bumped only when a consumer actually fails
 * (`onFailure`), NEVER on a lease. This is the P2-1 fix (AUDIT4): the previous code incremented
 * `attempts` at claim time, so a worker crash / lease expiry between claim and a completed dispatch
 * burned an attempt with no real delivery error — under worker churn a HEALTHY event could reach
 * MAX_ATTEMPTS and be silently dead-lettered though it never failed. Leasing (visibility timeout) and
 * attempt-accounting (dead-letter budget) are now cleanly separated: re-leasing is free, only a
 * consumer throw walks an event toward dead-letter. Delivery is at-least-once; consumers must be
 * idempotent. Registered only in the worker context (OutboxRelayModule).
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
    // Lease only — NOT attempts++ (P2-1): a lease is not a delivery attempt. `next_attempt_at` is
    // pushed forward so a crashed/slow worker's rows reappear after the visibility timeout with their
    // attempt budget INTACT; `attempts` advances solely on a real consumer failure (onFailure).
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events o
      SET next_attempt_at = NOW() + make_interval(secs => ${LEASE_SECONDS})
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
      // The number of the attempt being made NOW (>=1 when handed to a consumer): the stored count of
      // prior failures + this one. Since claim() no longer bumps attempts, row.attempts is that prior
      // count (0 on the first real delivery).
      attempts: row.attempts + 1,
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
    // THIS failed delivery is the attempt that counts (P2-1): persist the incremented budget here, the
    // single place a real failure is recorded. A row dead-letters only after MAX_ATTEMPTS genuine throws.
    const attempts = row.attempts + 1;

    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.outbox_events.update({
        where: { id: row.id },
        data: { attempts, last_error: message, dead_lettered_at: new Date() },
      });
      this.logger.error(
        `Outbox event ${row.id} (${row.event_type}) dead-lettered after ${attempts} failed attempts: ${message}`,
      );
      return;
    }

    const delay = backoffSeconds(attempts);
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET attempts = ${attempts}, last_error = ${message}, next_attempt_at = NOW() + make_interval(secs => ${delay})
      WHERE id = ${row.id}::uuid`;
    this.logger.warn(
      `Outbox event ${row.id} (${row.event_type}) failed (attempt ${attempts}), retry in ${delay}s: ${message}`,
    );
  }
}
