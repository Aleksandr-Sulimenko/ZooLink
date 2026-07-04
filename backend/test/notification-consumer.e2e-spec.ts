/**
 * Sub-wave C4 — the FIRST real outbox consumer (NotificationConsumer, ADR-0021) end-to-end against the
 * real stack (PG). Proves the event layer is no longer silent: a produced transactional event is relayed
 * and materialized into a durable IN_APP `notification_logs` row. Covers the ADR-0021 §Test-invariants:
 *   1. produce → relay tick → exactly one IN_APP row per notifiable event type (correct template/recipient)
 *   2. dedup — redelivering the same event.id yields exactly one row (idempotency_key ON CONFLICT)
 *   3. forward-only — an event already stamped processed is never re-notified (the deliberate cut)
 *   4. transactional-always — a recipient with notification_prefs all-off still gets the IN_APP row
 *   + org-directed fan-out to org-admins, and system-expiry notifying BOTH parties.
 * e2e hits HOST pg (localhost). The relay does not auto-poll under NODE_ENV=test; we drive tick() directly.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { WorkerModule } from '../src/worker.module';
import { PrismaService } from '../src/lib/db/prisma.service';
import { OutboxService } from '../src/lib/outbox/outbox.service';
import { OutboxRelay } from '../src/lib/outbox/outbox.relay';
import { NotificationConsumer } from '../src/modules/notification/notification.consumer';
import type { OutboxEvent } from '../src/lib/outbox/outbox.types';

describe('C4 — notification outbox consumer (e2e)', () => {
  let ctx: INestApplicationContext;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let relay: OutboxRelay;
  let consumer: NotificationConsumer;

  const userIds: string[] = [];
  const eventIds: string[] = [];
  let seller: string; // default-prefs seller (Moderation.Decided recipient)
  let prefsOff: string; // notification_prefs all-off (transactional-always)
  let initiator: string;
  let recipient: string;
  let orgId: string;
  let orgAdmin: string;

  const mkUser = async (data: Record<string, unknown> = {}): Promise<string> => {
    const u = await prisma.users.create({
      data: { full_name: 'C4', role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true, ...data },
    });
    userIds.push(u.id);
    return u.id;
  };

  /** Publish an event through the real outbox writer (in a tx, as a producer would). Returns event id. */
  const produce = async (
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
    aggregateType = 'Listing',
  ): Promise<string> => {
    const ev = (await prisma.$transaction((tx) =>
      outbox.publish(tx, { aggregateType, aggregateId, eventType, schemaVersion: 1, market: 'pet', payload }),
    )) as { id: string };
    eventIds.push(ev.id);
    return ev.id;
  };

  /** An OutboxEvent envelope for driving consumer.handle() directly (bypassing the relay). */
  const event = (eventType: string, payload: Record<string, unknown>, aggregateType = 'Listing'): OutboxEvent => ({
    id: randomUUID(),
    aggregateType,
    aggregateId: randomUUID(),
    eventType,
    payload: { schemaVersion: 1, occurredAt: new Date().toISOString(), market: 'pet', ...payload },
    attempts: 1,
  });

  const rowsFor = (userId: string, type = 'IN_APP') =>
    prisma.notification_logs.findMany({ where: { user_id: userId, type } });

  beforeAll(async () => {
    ctx = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await ctx.init();
    prisma = ctx.get(PrismaService);
    outbox = ctx.get(OutboxService);
    relay = ctx.get(OutboxRelay);
    consumer = ctx.get(NotificationConsumer);

    seller = await mkUser();
    prefsOff = await mkUser({ notification_prefs: { email: false, sms: false, promo: false }, preferred_language: 'en' });
    initiator = await mkUser();
    recipient = await mkUser();
    orgAdmin = await mkUser();
    const org = await prisma.organizations.create({ data: { name_localized: { en: 'C4 Org', ru: 'C4 Орг' }, status: 'ACTIVE', is_active: true } });
    orgId = org.id;
    await prisma.organization_users.create({ data: { organization_id: orgId, user_id: orgAdmin, role_in_org: 'OWNER', status: 'ACTIVE' } });
  });

  afterAll(async () => {
    await prisma.notification_logs.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => undefined);
    await prisma.outbox_events.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
    await prisma.organization_users.deleteMany({ where: { organization_id: orgId } }).catch(() => undefined);
    if (orgId) await prisma.organizations.delete({ where: { id: orgId } }).catch(() => undefined);
    for (const id of userIds) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await ctx.close();
  });

  // ── 1. produce → relay tick → materialize (the headline: full wiring incl. relay dispatch) ──────
  it('INV-1 (relay path): Moderation.Decided=APPROVED → relay tick → one IN_APP row for the seller', async () => {
    const eid = await produce('Moderation.Decided', randomUUID(), { entityType: 'LISTING', entityId: randomUUID(), sellerId: seller, decision: 'APPROVED', reason: null });
    // Drain until our event is processed (relay claims oldest-first in batches; loop past any backlog).
    for (let i = 0; i < 20; i++) {
      await relay.tick();
      const row = await prisma.outbox_events.findUnique({ where: { id: eid } });
      if (row?.processed_at) break;
    }

    const notif = await prisma.notification_logs.findFirst({
      where: { user_id: seller, type: 'IN_APP', idempotency_key: `${eid}:${seller}:listing_approved` },
    });
    expect(notif).not.toBeNull();
    expect(notif!.template_id).not.toBeNull();
    expect((notif!.content ?? '').length).toBeGreaterThan(0);
    expect(notif!.status).toBe('SENT');
    const processed = await prisma.outbox_events.findUnique({ where: { id: eid } });
    expect(processed!.processed_at).not.toBeNull(); // relay marked it done
  });

  // ── 1b. per-event coverage via consumer.handle() (deterministic, isolated) ──────────────────────
  it('INV-1: every notifiable event type materializes one IN_APP row with the right template', async () => {
    const cases: Array<{ ev: OutboxEvent; user: string; template: string }> = [
      { ev: event('Moderation.Decided', { sellerId: seller, decision: 'REJECTED', reason: 'poor_photos', entityId: randomUUID() }), user: seller, template: 'listing_rejected' },
      { ev: event('Moderation.Decided', { sellerId: seller, decision: 'CHANGES_REQUESTED', reason: 'incomplete', entityId: randomUUID() }), user: seller, template: 'listing_changes_requested' },
      { ev: event('OwnershipTransfer.Initiated', { transferId: randomUUID(), animalId: randomUUID(), fromUserId: initiator, toUserId: recipient }, 'OwnershipTransfer'), user: recipient, template: 'transfer_initiated' },
      { ev: event('OwnershipTransfer.Accepted', { transferId: randomUUID(), animalId: randomUUID(), fromUserId: initiator, toUserId: recipient }, 'OwnershipTransfer'), user: initiator, template: 'transfer_accepted' },
      { ev: event('OwnershipTransfer.Declined', { transferId: randomUUID(), animalId: randomUUID(), fromUserId: initiator, toUserId: recipient }, 'OwnershipTransfer'), user: initiator, template: 'transfer_declined' },
      { ev: event('OwnershipTransfer.Cancelled', { transferId: randomUUID(), animalId: randomUUID(), fromUserId: initiator, toUserId: recipient }, 'OwnershipTransfer'), user: recipient, template: 'transfer_cancelled' },
    ];
    for (const c of cases) {
      await consumer.handle(c.ev);
      const notif = await prisma.notification_logs.findFirst({ where: { user_id: c.user, idempotency_key: `${c.ev.id}:${c.user}:${c.template}` } });
      expect(notif).not.toBeNull();
      expect(notif!.type).toBe('IN_APP');
    }
  });

  // ── 2. dedup (idempotency_key ON CONFLICT DO NOTHING) ───────────────────────────────────────────
  it('INV-2 (dedup): redelivering the same event.id yields exactly one row', async () => {
    const ev = event('Moderation.Decided', { sellerId: seller, decision: 'APPROVED', reason: null, entityId: randomUUID() });
    await consumer.handle(ev);
    await consumer.handle(ev); // at-least-once redelivery
    const rows = await prisma.notification_logs.findMany({ where: { idempotency_key: `${ev.id}:${seller}:listing_approved` } });
    expect(rows.length).toBe(1);
  });

  // ── 3. forward-only (probe C13): a processed-before-consumer event is never re-notified ──────────
  it('INV-3 (forward-only): an event already stamped processed_at is not notified on a later tick', async () => {
    const eid = await produce('Moderation.Decided', randomUUID(), { sellerId: recipient, decision: 'APPROVED', reason: null, entityId: randomUUID() });
    // Simulate the relay having processed it while no consumer existed (the forward-only cut).
    await prisma.outbox_events.update({ where: { id: eid }, data: { processed_at: new Date() } });
    const before = (await rowsFor(recipient)).length;
    await relay.tick();
    await relay.tick();
    const after = (await rowsFor(recipient)).length;
    expect(after).toBe(before); // no notification for the pre-consumer event
    expect(await prisma.notification_logs.count({ where: { idempotency_key: `${eid}:${recipient}:listing_approved` } })).toBe(0);
  });

  // ── 4. transactional-always: prefs all-off still gets the row (ФЗ-38 transactional ≠ advertising) ─
  it('INV-4 (transactional-always): a recipient with notification_prefs all-off still gets the IN_APP row', async () => {
    const ev = event('Moderation.Decided', { sellerId: prefsOff, decision: 'APPROVED', reason: null, entityId: randomUUID() });
    await consumer.handle(ev);
    const notif = await prisma.notification_logs.findFirst({ where: { user_id: prefsOff, idempotency_key: `${ev.id}:${prefsOff}:listing_approved` } });
    expect(notif).not.toBeNull();
    // en-preferred user → rendered from the en template (content is non-empty English body).
    expect((notif!.content ?? '')).toContain('approved');
  });

  // ── org-directed fan-out: an org recipient notifies every ACTIVE org-admin ──────────────────────
  it('org fan-out: a transfer to an organization notifies its org-admins', async () => {
    const ev = event('OwnershipTransfer.Initiated', { transferId: randomUUID(), animalId: randomUUID(), fromUserId: initiator, toOrganizationId: orgId }, 'OwnershipTransfer');
    await consumer.handle(ev);
    const notif = await prisma.notification_logs.findFirst({ where: { user_id: orgAdmin, idempotency_key: `${ev.id}:${orgAdmin}:transfer_initiated` } });
    expect(notif).not.toBeNull();
  });

  // ── system expiry → BOTH parties ────────────────────────────────────────────────────────────────
  it('OwnershipTransfer.Expired notifies BOTH parties (no human actor)', async () => {
    const ev = event('OwnershipTransfer.Expired', { transferId: randomUUID(), animalId: randomUUID(), fromUserId: initiator, toUserId: recipient }, 'OwnershipTransfer');
    await consumer.handle(ev);
    expect(await prisma.notification_logs.count({ where: { idempotency_key: `${ev.id}:${initiator}:transfer_expired` } })).toBe(1);
    expect(await prisma.notification_logs.count({ where: { idempotency_key: `${ev.id}:${recipient}:transfer_expired` } })).toBe(1);
  });
});
