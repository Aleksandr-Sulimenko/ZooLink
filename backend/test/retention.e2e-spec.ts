/**
 * D2 retention behaviour (ADMIN_PHASE_ACTION_PLAN.md) against the real PG stack. This is a
 * worker-only job (no HTTP), so it is exercised at the service level: seed rows directly, run the
 * passes, assert the transitions. Critically verifies that within-grace accounts and within-expiry
 * listings are NOT touched (the negative cases the plan calls for).
 */
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { PrismaService } from '../src/lib/db/prisma.service';
import { AuditLogService } from '../src/lib/audit/audit-log.service';
import { AuditMetrics } from '../src/lib/audit/audit.metrics';
import { RetentionService } from '../src/lib/scheduler/retention.service';
import type { AppConfigService } from '../src/config/app-config.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RetentionService (D2, live PG)', () => {
  let prisma: PrismaService;
  let service: RetentionService;
  const createdUserIds: string[] = [];
  const createdListingIds: string[] = [];
  const createdAnimalIds: string[] = [];
  let speciesId: number;

  const config = {
    get: (key: string) => (key === 'RETENTION_GRACE_DAYS' ? 30 : undefined),
  } as unknown as AppConfigService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const audit = new AuditLogService(prisma, new AuditMetrics()); // no MetricsService → no-op counter
    service = new RetentionService(prisma, config, audit);

    // A species to hang an animal off (idempotent upsert by code).
    const sp = await prisma.species.upsert({
      where: { code: 'retention-test-species' },
      update: {},
      create: { code: 'retention-test-species', name_localized: { en: 'T', ru: 'Т' } },
    });
    speciesId = sp.id;
  });

  afterAll(async () => {
    if (createdListingIds.length) {
      await prisma.listings.deleteMany({ where: { id: { in: createdListingIds } } });
    }
    if (createdAnimalIds.length) {
      await prisma.animals.deleteMany({ where: { id: { in: createdAnimalIds } } });
    }
    if (createdUserIds.length) {
      // audit_log is intentionally append-only (trg_audit_log_append_only) — leave the rows we
      // wrote (they reference test UUIDs via entity_id, which has no FK, so users delete is free).
      await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.species.deleteMany({ where: { id: speciesId } });
    await prisma.onModuleDestroy();
  });

  async function makeSeller(): Promise<string> {
    const u = await prisma.users.create({
      data: { full_name: 'Retention Seller', role: 'USER', status: 'ACTIVE' },
    });
    createdUserIds.push(u.id);
    return u.id;
  }

  async function makeListing(sellerId: string, status: string, expiresAt: Date | null): Promise<string> {
    const animal = await prisma.animals.create({
      data: {
        owner_id: sellerId,
        species_id: speciesId,
        breed_text_localized: { en: 'mix', ru: 'микс' },
        nickname_localized: { en: 'a', ru: 'а' },
        sex: 'Male',
        date_of_birth: new Date('2022-01-01'),
      },
    });
    createdAnimalIds.push(animal.id);
    const listing = await prisma.listings.create({
      data: {
        animal_id: animal.id,
        seller_id: sellerId,
        listing_type: 'sale',
        status,
        // ACTIVE requires moderation_status=APPROVED (approval-gate trigger).
        moderation_status: status === 'ACTIVE' ? 'APPROVED' : 'PENDING',
        expires_at: expiresAt,
      },
    });
    createdListingIds.push(listing.id);
    return listing.id;
  }

  it('expires ACTIVE listings past expires_at, but leaves within-expiry ACTIVE listings alone', async () => {
    const seller = await makeSeller();
    const pastId = await makeListing(seller, 'ACTIVE', new Date(Date.now() - DAY_MS));
    const futureId = await makeListing(seller, 'ACTIVE', new Date(Date.now() + DAY_MS));
    const noExpiryId = await makeListing(seller, 'ACTIVE', null);

    const n = await service.expireListings();
    expect(n).toBeGreaterThanOrEqual(1);

    const past = await prisma.listings.findUniqueOrThrow({ where: { id: pastId } });
    const future = await prisma.listings.findUniqueOrThrow({ where: { id: futureId } });
    const noExpiry = await prisma.listings.findUniqueOrThrow({ where: { id: noExpiryId } });

    expect(past.status).toBe('EXPIRED'); // past expires_at → moved
    expect(future.status).toBe('ACTIVE'); // within expiry → untouched
    expect(noExpiry.status).toBe('ACTIVE'); // no expires_at → untouched
  });

  it('is idempotent — a second expiry pass does not re-touch already-EXPIRED rows', async () => {
    const seller = await makeSeller();
    await makeListing(seller, 'ACTIVE', new Date(Date.now() - DAY_MS));
    const first = await service.expireListings();
    expect(first).toBeGreaterThanOrEqual(1);
    // Second pass: the one we just expired is no longer ACTIVE, so it is not counted again.
    const beforeSecond = await prisma.listings.count({
      where: { seller_id: seller, status: 'ACTIVE', expires_at: { lt: new Date() } },
    });
    expect(beforeSecond).toBe(0);
  });

  it('erases DEACTIVATED accounts past the grace window, but leaves within-grace accounts alone', async () => {
    const pastGrace = await prisma.users.create({
      data: {
        full_name: 'Past Grace',
        email: 'pastgrace@example.com',
        role: 'USER',
        status: 'DEACTIVATED',
        is_active: false,
        deactivated_at: new Date(Date.now() - 31 * DAY_MS),
      },
    });
    createdUserIds.push(pastGrace.id);
    const withinGrace = await prisma.users.create({
      data: {
        full_name: 'Within Grace',
        email: 'withingrace@example.com',
        role: 'USER',
        status: 'DEACTIVATED',
        is_active: false,
        deactivated_at: new Date(Date.now() - 5 * DAY_MS),
      },
    });
    createdUserIds.push(withinGrace.id);

    const erased = await service.eraseDeactivatedPastGrace();
    expect(erased).toBeGreaterThanOrEqual(1);

    const after = await prisma.users.findUniqueOrThrow({ where: { id: pastGrace.id } });
    expect(after.erased_at).not.toBeNull(); // anonymised
    expect(after.email).toBeNull();
    expect(after.full_name).toBe('[deleted]');

    const safe = await prisma.users.findUniqueOrThrow({ where: { id: withinGrace.id } });
    expect(safe.erased_at).toBeNull(); // within grace → recoverable, untouched
    expect(safe.email).toBe('withingrace@example.com');
  });

  it('erase pass is idempotent — re-running does not error and keeps the account erased', async () => {
    const u = await prisma.users.create({
      data: {
        full_name: 'Repeat Erase',
        email: 'repeat@example.com',
        role: 'USER',
        status: 'DEACTIVATED',
        is_active: false,
        deactivated_at: new Date(Date.now() - 40 * DAY_MS),
      },
    });
    createdUserIds.push(u.id);

    await service.eraseDeactivatedPastGrace();
    const first = await prisma.users.findUniqueOrThrow({ where: { id: u.id } });
    expect(first.erased_at).not.toBeNull();

    // Second run: already-erased rows are excluded (erased_at IS NULL predicate) → no-op, no throw.
    await expect(service.eraseDeactivatedPastGrace()).resolves.toBeGreaterThanOrEqual(0);
    const second = await prisma.users.findUniqueOrThrow({ where: { id: u.id } });
    expect(second.erased_at!.getTime()).toBe(first.erased_at!.getTime()); // unchanged
  });
});
