/**
 * Slice 4c (A) — SLA-escalation job (ModerationEscalationService) against the real PG stack. A
 * worker-only job (no HTTP), exercised at the service level: seed PENDING_MODERATION listings with
 * backdated `moderation_enqueued_at`, run the pass, assert the Moderation.Escalated outbox emission +
 * the escalated_at marker. Covers SLA-1 (idempotent — exactly one event), SLA-3 (no status mutation),
 * SLA-4 (escalated_at-NULL filter re-escalates), SLA-5 (threshold boundary). SLA-2 (advisory lock /
 * single-instance) reuses the AdvisoryLockService proven by the retention job.
 */
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { PrismaService } from '../src/lib/db/prisma.service';
import { OutboxService } from '../src/lib/outbox/outbox.service';
import { ModerationEscalationService } from '../src/lib/scheduler/moderation-escalation.service';

const HOUR = 3600_000;

describe('ModerationEscalationService (Slice 4c-A, live PG)', () => {
  let prisma: PrismaService;
  let service: ModerationEscalationService;
  const listingIds: string[] = [];
  const animalIds: string[] = [];
  let userId: string;
  let petSp: number;
  let liveSp: number;

  /** Seed a PENDING_MODERATION listing for `speciesId`, enqueued `hoursAgo` hours ago. */
  const seedPending = async (speciesId: number, hoursAgo: number): Promise<string> => {
    const animal = await prisma.animals.create({
      data: { owner_id: userId, species_id: speciesId, breed_text_localized: { en: 'm', ru: 'м' }, nickname_localized: { en: 'a', ru: 'а' }, sex: 'Male', date_of_birth: new Date('2022-01-01') },
    });
    animalIds.push(animal.id);
    const listing = await prisma.listings.create({
      data: {
        animal_id: animal.id,
        seller_id: userId,
        listing_type: 'sale',
        title_localized: { en: 't', ru: 'т' },
        status: 'PENDING_MODERATION',
        moderation_status: 'PENDING',
        moderation_enqueued_at: new Date(Date.now() - hoursAgo * HOUR),
      },
    });
    listingIds.push(listing.id);
    return listing.id;
  };

  const eventsFor = (listingId: string) =>
    prisma.outbox_events.findMany({ where: { aggregate_id: listingId, event_type: 'Moderation.Escalated' } });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new ModerationEscalationService(prisma, new OutboxService());

    userId = (await prisma.users.create({ data: { full_name: 'EscSeller', role: 'USER', status: 'ACTIVE' } })).id;
    petSp = (await prisma.species.upsert({ where: { code: 'esc-pet-sp' }, update: {}, create: { code: 'esc-pet-sp', name_localized: { en: 'Dog', ru: 'Пёс' }, market: 'pet' } })).id;
    liveSp = (await prisma.species.upsert({ where: { code: 'esc-live-sp' }, update: {}, create: { code: 'esc-live-sp', name_localized: { en: 'Cow', ru: 'Корова' }, market: 'livestock' } })).id;
  });

  afterAll(async () => {
    await prisma.outbox_events.deleteMany({ where: { aggregate_id: { in: listingIds } } }).catch(() => undefined);
    if (listingIds.length) await prisma.listings.deleteMany({ where: { id: { in: listingIds } } });
    if (animalIds.length) await prisma.animals.deleteMany({ where: { id: { in: animalIds } } });
    if (userId) await prisma.users.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.species.deleteMany({ where: { code: { in: ['esc-pet-sp', 'esc-live-sp'] } } }).catch(() => undefined);
    await prisma.onModuleDestroy();
  });

  it('escalates a pet item past the 8h (4h×2) threshold: one Moderation.Escalated event + escalated_at set', async () => {
    const id = await seedPending(petSp, 9); // 9h > 8h → escalate
    await service.runOnce();
    const events = await eventsFor(id);
    expect(events).toHaveLength(1);
    const payload = events[0].payload as { entityId: string; market: string; slaState: string; waitingSeconds: number };
    expect(payload).toEqual(expect.objectContaining({ entityId: id, market: 'pet', slaState: 'ESCALATED' }));
    expect(payload.waitingSeconds).toBeGreaterThan(8 * 3600);
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.escalated_at).not.toBeNull();
  });

  it('SLA-1: a second tick on the same item does NOT emit a second event (idempotent)', async () => {
    const id = await seedPending(petSp, 9);
    await service.runOnce();
    await service.runOnce(); // second tick — escalated_at now set
    expect(await eventsFor(id)).toHaveLength(1);
  });

  it('SLA-3: the escalated item stays PENDING_MODERATION / moderation_status PENDING (no auto-decide)', async () => {
    const id = await seedPending(petSp, 10);
    await service.runOnce();
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('PENDING_MODERATION');
    expect(row?.moderation_status).toBe('PENDING');
  });

  it('SLA-5: a pet item just UNDER the 8h threshold is NOT escalated; just OVER is', async () => {
    const under = await seedPending(petSp, 7); // 7h < 8h → not escalated
    const over = await seedPending(petSp, 8.5); // 8.5h > 8h → escalated
    await service.runOnce();
    expect(await eventsFor(under)).toHaveLength(0);
    expect((await prisma.listings.findUnique({ where: { id: under } }))?.escalated_at).toBeNull();
    expect(await eventsFor(over)).toHaveLength(1);
  });

  it('SLA-5: livestock uses the 12h (6h×2) threshold — a 9h pet escalates but a 9h livestock does not', async () => {
    const pet9 = await seedPending(petSp, 9); // > 8h pet threshold → escalate
    const live9 = await seedPending(liveSp, 9); // < 12h livestock threshold → not escalated
    await service.runOnce();
    expect(await eventsFor(pet9)).toHaveLength(1);
    expect(await eventsFor(live9)).toHaveLength(0);
    // …but a 13h livestock item DOES escalate.
    const live13 = await seedPending(liveSp, 13);
    await service.runOnce();
    expect(await eventsFor(live13)).toHaveLength(1);
  });

  it('SLA-4: resetting escalated_at to NULL (the 4d re-enqueue contract) lets the item re-escalate', async () => {
    const id = await seedPending(petSp, 9);
    await service.runOnce();
    expect(await eventsFor(id)).toHaveLength(1);
    // Simulate the 4d re-enqueue reset (the job only honours `escalated_at IS NULL`).
    await prisma.listings.update({ where: { id }, data: { escalated_at: null } });
    await service.runOnce();
    expect(await eventsFor(id)).toHaveLength(2); // re-escalated after the reset
  });
});
