/**
 * AUDIT4 P1-2 — consent "current row" tie-break is MONOTONIC (mig 0036 `consents.seq`), against real PG.
 * `consents` is append-only: current state = the latest row for (subject, kind). Two rows written in the
 * same microsecond TIE on `created_at`; the old `[created_at DESC, id DESC]` order then decided the winner
 * by a RANDOM UUID and could let a withdrawal LOSE to the grant it supersedes (fails OPEN → ст.9 ч.2 break).
 * These tests insert two rows with IDENTICAL `created_at` and assert `ConsentService.currentlyGranted`
 * resolves by causal insertion order (`seq DESC`), deterministically — the row written LAST wins.
 *
 * Real PG is required: `seq` is `GENERATED ALWAYS AS IDENTITY` (DB-assigned monotonic order).
 */
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/lib/db/prisma.service';
import { ConsentService } from '../src/modules/identity/consent.service';

const SAME_TS = new Date('2026-07-08T12:00:00.000Z'); // identical wall-clock timestamp for both rows

describe('Consent monotonic seq tie-break (AUDIT4 P1-2, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let consent: ConsentService;
  const userIds: string[] = [];

  const mkUser = async (name: string): Promise<string> => {
    const u = await prisma.users.create({
      data: { full_name: name, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    userIds.push(u.id);
    return u.id;
  };

  /** Insert a consent row at a FIXED created_at (seq is auto-assigned by the DB, strictly increasing). */
  const insertAt = (userId: string, granted: boolean, createdAt: Date): Promise<unknown> =>
    prisma.consents.create({
      data: {
        user_id: userId,
        consent_type: 'CONTACT_DISTRIBUTION',
        granted,
        policy_version: '1.0',
        source: 'TEST',
        actor_id: userId,
        created_at: createdAt,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    consent = app.get(ConsentService);
  });

  afterAll(async () => {
    // consents is append-only (trg_consents_immutable) — disable the trigger for test cleanup only.
    await prisma.$executeRaw`ALTER TABLE consents DISABLE TRIGGER trg_consents_immutable`.catch(() => undefined);
    for (const id of userIds) await prisma.consents.deleteMany({ where: { user_id: id } }).catch(() => undefined);
    await prisma.$executeRaw`ALTER TABLE consents ENABLE TRIGGER trg_consents_immutable`.catch(() => undefined);
    for (const id of userIds) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it('same-timestamp grant→withdrawal: withdrawal written LAST wins → currentlyGranted === false', async () => {
    const uid = await mkUser('SeqWithdrawWins');
    await insertAt(uid, true, SAME_TS); // grant first
    await insertAt(uid, false, SAME_TS); // withdrawal second, identical created_at
    await expect(consent.currentlyGranted(uid, 'CONTACT_DISTRIBUTION')).resolves.toBe(false);
  });

  it('same-timestamp withdrawal→grant: grant written LAST wins → currentlyGranted === true (fail-safe by causality, not deny-wins)', async () => {
    const uid = await mkUser('SeqGrantWins');
    await insertAt(uid, false, SAME_TS); // withdrawal first
    await insertAt(uid, true, SAME_TS); // grant second, identical created_at
    await expect(consent.currentlyGranted(uid, 'CONTACT_DISTRIBUTION')).resolves.toBe(true);
  });

  it('no consent row → default-deny (false), unchanged by mig 0036', async () => {
    const uid = await mkUser('SeqNoRow');
    await expect(consent.currentlyGranted(uid, 'CONTACT_DISTRIBUTION')).resolves.toBe(false);
  });

  // ── AUDIT4 P2-4: prove the append-only guarantee actually FIRES (not just disabled in cleanup) ──
  describe('consents append-only immutability (trg_consents_immutable ENABLED)', () => {
    it('rejects a raw UPDATE on an existing consents row (ФЗ-152 append-only proof)', async () => {
      const uid = await mkUser('AppendOnlyUpdate');
      const created = (await insertAt(uid, true, new Date())) as { id: string };
      // The trigger is ENABLED here (only disabled in afterAll cleanup) — the mutation MUST raise.
      await expect(
        prisma.consents.update({ where: { id: created.id }, data: { granted: false } }),
      ).rejects.toThrow(/append-only/i);
      // And the row is untouched — the withdrawal never took effect (grant still current).
      await expect(consent.currentlyGranted(uid, 'CONTACT_DISTRIBUTION')).resolves.toBe(true);
    });

    it('rejects a raw DELETE on an existing consents row (append-only proof)', async () => {
      const uid = await mkUser('AppendOnlyDelete');
      const created = (await insertAt(uid, true, new Date())) as { id: string };
      await expect(prisma.consents.delete({ where: { id: created.id } })).rejects.toThrow(/append-only/i);
      // The row survives the rejected delete.
      const still = await prisma.consents.findUnique({ where: { id: created.id } });
      expect(still).not.toBeNull();
    });
  });
});
