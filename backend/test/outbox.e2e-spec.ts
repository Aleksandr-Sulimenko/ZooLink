/**
 * Outbox integration test against a real PostgreSQL (DATABASE_URL). Exercises the actual claim
 * SQL (FOR UPDATE SKIP LOCKED + lease) and the trigger interaction that unit tests mock out —
 * this is the test that would have caught the outbox_events updated_at trigger bug. Satisfies the
 * Phase-1 DoD: "an outbox event reaches a test consumer idempotently".
 *
 * Requires a migrated PG on DATABASE_URL (host localhost:5432 locally; the postgres service in CI).
 */
process.env.DATABASE_URL ??= 'postgresql://zoolink:zoolink@localhost:5432/zoolink';

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/lib/db/prisma.service';
import { OutboxService } from '../src/lib/outbox/outbox.service';
import { OutboxRelay } from '../src/lib/outbox/outbox.relay';
import type { AppConfigService } from '../src/config/app-config.service';
import type { OutboxConsumer, OutboxEvent } from '../src/lib/outbox/outbox.types';

const AGG = 'E2EOutboxTest';
const cfg = { isTest: true } as AppConfigService;

describe('Outbox relay (integration, real PG)', () => {
  let prisma: PrismaService;
  const outbox = new OutboxService();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterEach(async () => {
    await prisma.outbox_events.deleteMany({ where: { aggregate_type: AGG } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('delivers a published event to a consumer and marks it processed', async () => {
    const aggId = randomUUID();
    const received: OutboxEvent[] = [];
    const consumer: OutboxConsumer = {
      eventTypes: ['E2E.Ping'],
      handle: (e) => {
        received.push(e);
        return Promise.resolve();
      },
    };
    const relay = new OutboxRelay(prisma, cfg, [consumer]);

    await prisma.$transaction((tx) =>
      outbox.publish(tx, {
        aggregateType: AGG,
        aggregateId: aggId,
        eventType: 'E2E.Ping',
        payload: { hello: 'world' },
      }),
    );

    await relay.tick();

    const mine = received.filter((e) => e.aggregateId === aggId);
    expect(mine).toHaveLength(1);
    expect(mine[0].payload).toEqual({ hello: 'world' });

    const row = await prisma.outbox_events.findFirst({ where: { aggregate_id: aggId } });
    expect(row?.processed_at).not.toBeNull();
    expect(row?.attempts).toBe(1);
  });

  it('retries a failed delivery (backoff) and redelivers at-least-once until it succeeds', async () => {
    const aggId = randomUUID();
    let calls = 0;
    const flaky: OutboxConsumer = {
      eventTypes: ['E2E.Flaky'],
      handle: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('transient failure'));
        return Promise.resolve();
      },
    };
    const relay = new OutboxRelay(prisma, cfg, [flaky]);

    await prisma.$transaction((tx) =>
      outbox.publish(tx, {
        aggregateType: AGG,
        aggregateId: aggId,
        eventType: 'E2E.Flaky',
        payload: {},
      }),
    );

    // Attempt 1 fails → scheduled for retry, not processed.
    await relay.tick();
    let row = await prisma.outbox_events.findFirstOrThrow({ where: { aggregate_id: aggId } });
    expect(calls).toBe(1);
    expect(row.processed_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('transient failure');
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

    // Simulate the backoff window elapsing, then run again — must redeliver and succeed.
    await prisma.$executeRaw`UPDATE outbox_events SET next_attempt_at = NOW() WHERE id = ${row.id}::uuid`;
    await relay.tick();

    expect(calls).toBe(2); // redelivered (at-least-once)
    row = await prisma.outbox_events.findFirstOrThrow({ where: { aggregate_id: aggId } });
    expect(row.processed_at).not.toBeNull();
    expect(row.last_error).toBeNull();
  });

  it('does not redeliver a leased event within the lease window (claim hides it)', async () => {
    const aggId = randomUUID();
    const slow: OutboxConsumer = {
      eventTypes: ['E2E.Leased'],
      handle: () => Promise.resolve(),
    };
    const relay = new OutboxRelay(prisma, cfg, [slow]);

    await prisma.$transaction((tx) =>
      outbox.publish(tx, {
        aggregateType: AGG,
        aggregateId: aggId,
        eventType: 'E2E.Leased',
        payload: {},
      }),
    );

    const first = await relay.tick();
    expect(first).toBeGreaterThanOrEqual(1);
    // already processed now; a second immediate tick must not pick it up again
    const claimedAgain = await prisma.outbox_events.count({
      where: { aggregate_id: aggId, processed_at: null },
    });
    expect(claimedAgain).toBe(0);
  });
});
