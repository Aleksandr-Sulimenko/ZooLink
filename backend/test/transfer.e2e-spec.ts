/**
 * Animal Slice 2 — ownership transfer (ADR-0013, transfers-api.yaml) end-to-end against the real
 * stack (PG + Redis). Exercises the simplified direct flow and every INV that crosses HTTP:
 * initiate/accept/decline/cancel/get/list, the atomic GUC re-attribution + history append
 * (INV-5/INV-14), single-active-PENDING (INV-4), self-transfer & exactly-one-of (INV-2/INV-3),
 * object-level authz (INV-1/8/9), terminal & expiry guards (INV-10/11), If-Match (INV-12), and the
 * agent-as-principal audit trail (INV-13). e2e hits HOST pg/redis (localhost); flush host redis if 429s.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/lib/http/problem.filter';
import { PrismaService } from '../src/lib/db/prisma.service';
import { resetThrottle } from './throttle-reset.util';

describe('Animal Slice 2 — ownership transfer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const animals: string[] = [];
  const transfers: string[] = [];
  let ownerId: string;
  let recipId: string;
  let strangerId: string;
  let adminId: string;
  let ownerTok: string;
  let recipTok: string;
  let strangerTok: string;
  let adminTok: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  let speciesId: number;
  let breedId: number;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const newAnimal = async (owner: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: {
        owner_id: owner,
        species_id: speciesId,
        breed_id: breedId,
        nickname_localized: { en: 'Xfer', ru: 'Передача' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animals.push(a.id);
    // Open the initial ownership interval so accept can close it (mirrors how Slice-1 create would seed it).
    await prisma.animal_ownership_history.create({
      data: { animal_id: a.id, owner_id: owner, start_date: new Date('2021-01-01T00:00:00Z') },
    });
    return a.id;
  };

  const initiate = (tok: string, animalId: string, body: Record<string, unknown>, key = randomUUID()) =>
    request(server()).post(`/v1/animals/${animalId}/transfers`).set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', key).send(body);
  const idOf = (res: { body: { id?: unknown } }): string => res.body.id as string;
  const track = (res: { body: { id?: unknown } }): string => {
    const id = idOf(res);
    transfers.push(id);
    return id;
  };
  const getEtag = async (tok: string, transferId: string): Promise<string> => {
    const r = await request(server()).get(`/v1/transfers/${transferId}`).set('Authorization', `Bearer ${tok}`).expect(200);
    return r.headers['etag'];
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);

    const mk = (n: string, role: string) =>
      prisma.users.create({ data: { full_name: n, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    ownerId = (await mk('XOwner', 'USER')).id;
    recipId = (await mk('XRecip', 'USER')).id;
    strangerId = (await mk('XStranger', 'USER')).id;
    adminId = (await mk('XAdmin', 'ADMIN')).id;
    [ownerTok, recipTok, strangerTok, adminTok] = await Promise.all([
      devToken(ownerId),
      devToken(recipId),
      devToken(strangerId),
      devToken(adminId),
    ]);

    const sp = await prisma.species.create({ data: { code: `xfer_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `xfer_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    for (const id of transfers) await prisma.ownership_transfers.delete({ where: { id } }).catch(() => undefined);
    for (const id of animals) {
      await prisma.animal_ownership_history.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.ownership_transfers.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    }
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of [ownerId, recipId, strangerId, adminId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  it('requires auth (401)', async () => {
    await request(server()).get('/v1/transfers?role=incoming').expect(401);
  });

  it('initiates a PENDING transfer (201, ETag, Location, initiatedBy snapshot)', async () => {
    const animalId = await newAnimal(ownerId);
    const res = await initiate(ownerTok, animalId, { toUserId: recipId, transferReason: 'rehome' }).expect(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.toUserId).toBe(recipId);
    expect(res.body.initiatedBy).toEqual(expect.objectContaining({ actorId: ownerId, principalType: 'HUMAN' }));
    expect(res.body.expiresAt).toBeTruthy();
    expect(res.headers['etag']).toBeTruthy();
    expect(res.headers['location']).toContain('/api/v1/transfers/');
    track(res);
  });

  it('INV-2: self-transfer → 422 SELF_TRANSFER', async () => {
    const animalId = await newAnimal(ownerId);
    const res = await initiate(ownerTok, animalId, { toUserId: ownerId }).expect(422);
    expect(res.body.code).toBe('SELF_TRANSFER');
  });

  it('INV-3: both recipients → 422 RECIPIENT_AMBIGUOUS; neither → 422 RECIPIENT_REQUIRED', async () => {
    const animalId = await newAnimal(ownerId);
    const org = await prisma.organizations.create({ data: { name_localized: { en: 'O', ru: 'О' }, status: 'ACTIVE' } });
    const a = await initiate(ownerTok, animalId, { toUserId: recipId, toOrganizationId: org.id }).expect(422);
    expect(a.body.code).toBe('RECIPIENT_AMBIGUOUS');
    const b = await initiate(ownerTok, animalId, {}).expect(422);
    expect(b.body.code).toBe('RECIPIENT_REQUIRED');
    await prisma.organizations.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  it('INV-1: a non-owner initiating → 403', async () => {
    const animalId = await newAnimal(ownerId);
    await initiate(strangerTok, animalId, { toUserId: recipId }).expect(403);
  });

  it('INV-4: a second PENDING for the same animal → 409 TRANSFER_ALREADY_PENDING', async () => {
    const animalId = await newAnimal(ownerId);
    track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const dup = await initiate(ownerTok, animalId, { toUserId: strangerId }).expect(409);
    expect(dup.body.code).toBe('TRANSFER_ALREADY_PENDING');
  });

  it('INV-5/INV-14: accept re-attributes the animal + appends history atomically', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, xfer);

    const res = await request(server())
      .post(`/v1/transfers/${xfer}/accept`)
      .set('Authorization', `Bearer ${recipTok}`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', etag)
      .expect(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.respondedBy).toEqual(expect.objectContaining({ actorId: recipId }));

    // Animal is now owned by the recipient.
    const animal = await prisma.animals.findUnique({ where: { id: animalId } });
    expect(animal?.owner_id).toBe(recipId);
    expect(animal?.owned_since).toBeTruthy();

    // History: prior interval closed, exactly one open interval (the recipient's).
    const hist = await prisma.animal_ownership_history.findMany({ where: { animal_id: animalId }, orderBy: { start_date: 'asc' } });
    const open = hist.filter((h) => h.end_date === null);
    expect(open).toHaveLength(1);
    expect(open[0].owner_id).toBe(recipId);
    expect(hist.find((h) => h.owner_id === ownerId)?.end_date).not.toBeNull();
  });

  it('TOCTOU: two parallel accepts (same valid ETag, distinct keys) → exactly one 200, exactly one open interval', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, xfer);

    // Fire both with the SAME valid If-Match but DISTINCT Idempotency-Keys (distinct keys so neither is
    // an idempotent replay — this genuinely races the inner guarded claim, not the idempotency cache).
    const fire = () =>
      request(server())
        .post(`/v1/transfers/${xfer}/accept`)
        .set('Authorization', `Bearer ${recipTok}`)
        .set('Idempotency-Key', randomUUID())
        .set('If-Match', etag)
        .send();
    const [a, b] = await Promise.all([fire(), fire()]);

    const statuses = [a.status, b.status].sort();
    // Exactly one winner (200); the loser is 409 (lost the inner status-guarded claim) or 412 (its
    // If-Match was stale by the time it read) — never two 200s.
    expect(statuses[0]).toBe(200);
    expect([409, 412]).toContain(statuses[1]);

    // The irreversible trail is single-winner: exactly ONE open interval, owned by the recipient.
    const hist = await prisma.animal_ownership_history.findMany({ where: { animal_id: animalId } });
    const open = hist.filter((h) => h.end_date === null);
    expect(open).toHaveLength(1);
    expect(open[0].owner_id).toBe(recipId);
    // And exactly one COMPLETED transfer (no double-complete).
    const completed = await prisma.ownership_transfers.findMany({ where: { animal_id: animalId, status: 'COMPLETED' } });
    expect(completed).toHaveLength(1);
  });

  it('INV-13: the accept audit row carries the acting principal', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, xfer);
    await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    const audit = await prisma.audit_log.findMany({ where: { entity_id: xfer, action: 'animal.transfer_accepted' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(recipId);
    expect(audit[0].actor_principal_type).toBe('HUMAN');
  });

  it('INV-8: a non-recipient cannot accept (403); INV-12: missing/stale If-Match → 428/412', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, xfer);
    // 403 is checked before If-Match, so no If-Match needed here.
    await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${strangerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(403);
    await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).expect(428);
    await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', 'W/"stale"').expect(412);
  });

  it('decline (T3) by the recipient → CANCELLED(declined); animal unchanged', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, xfer);
    const res = await request(server()).post(`/v1/transfers/${xfer}/decline`).set('Authorization', `Bearer ${recipTok}`).set('If-Match', etag).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.terminalReason).toBe('declined');
    const animal = await prisma.animals.findUnique({ where: { id: animalId } });
    expect(animal?.owner_id).toBe(ownerId);
  });

  it('cancel (T4) by the initiator → CANCELLED(cancelled_by_initiator); INV-9 non-initiator → 403', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(ownerTok, xfer);
    await request(server()).post(`/v1/transfers/${xfer}/cancel`).set('Authorization', `Bearer ${recipTok}`).set('If-Match', etag).expect(403);
    const res = await request(server()).post(`/v1/transfers/${xfer}/cancel`).set('Authorization', `Bearer ${ownerTok}`).set('If-Match', etag).expect(200);
    expect(res.body.terminalReason).toBe('cancelled_by_initiator');
  });

  it('INV-10: accept on a terminal transfer → 409 TRANSFER_NOT_PENDING; INV-4 slot freed for re-initiate', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    let etag = await getEtag(ownerTok, xfer);
    await request(server()).post(`/v1/transfers/${xfer}/cancel`).set('Authorization', `Bearer ${ownerTok}`).set('If-Match', etag).expect(200);
    etag = await getEtag(ownerTok, xfer);
    await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(409);
    // The partial-unique PENDING slot is free → a fresh transfer may be initiated.
    track(await initiate(ownerTok, animalId, { toUserId: strangerId }).expect(201));
  });

  it('INV-11: accept after expiry → 409 TRANSFER_EXPIRED + transitioned to CANCELLED(expired)', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    // Force expiry by back-dating expires_at directly.
    await prisma.ownership_transfers.update({ where: { id: xfer }, data: { expires_at: new Date(Date.now() - 1000) } });
    const etag = await getEtag(recipTok, xfer); // GET surfaces it as CANCELLED(expired) lazily
    const res = await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(409);
    expect(res.body.code).toBe('TRANSFER_EXPIRED');
    const after = await prisma.ownership_transfers.findUnique({ where: { id: xfer } });
    expect(after?.status).toBe('CANCELLED');
    expect(after?.failure_reason).toBe('expired');
  });

  it('lists my transfers (role=incoming / initiated) with the PageMeta envelope; role required', async () => {
    await request(server()).get('/v1/transfers').set('Authorization', `Bearer ${recipTok}`).expect(400);
    const incoming = await request(server()).get('/v1/transfers?role=incoming&limit=100').set('Authorization', `Bearer ${recipTok}`).expect(200);
    expect(Array.isArray(incoming.body.items)).toBe(true);
    expect(incoming.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 100, total: expect.any(Number) }));
    for (const t of incoming.body.items as { toUserId: string | null }[]) {
      expect(t.toUserId).toBe(recipId);
    }
    const initiated = await request(server()).get('/v1/transfers?role=initiated&limit=100').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    for (const t of initiated.body.items as { fromUserId: string | null }[]) {
      expect(t.fromUserId).toBe(ownerId);
    }
  });

  it('GET /transfers/{id}: a non-party USER → 403; ADMIN may read', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    await request(server()).get(`/v1/transfers/${xfer}`).set('Authorization', `Bearer ${strangerTok}`).expect(403);
    await request(server()).get(`/v1/transfers/${xfer}`).set('Authorization', `Bearer ${adminTok}`).expect(200);
  });

  it('GET /animals/{id}/ownership-history returns the settled trail (PageMeta, org-capable shape)', async () => {
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, xfer);
    await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);

    const res = await request(server()).get(`/v1/animals/${animalId}/ownership-history?limit=100`).set('Authorization', `Bearer ${recipTok}`).expect(200);
    expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 100 }));
    const items = res.body.items as { ownerId: string | null; organizationId: string | null; endDate: string | null }[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.every((i) => (i.ownerId === null) !== (i.organizationId === null))).toBe(true); // exactly-one-of
  });

  it('list: an invalid ?status=FOO → 400 (not a silent empty list)', async () => {
    await request(server()).get('/v1/transfers?role=incoming&status=FOO').set('Authorization', `Bearer ${recipTok}`).expect(400);
  });

  it('INV-6: a direct UPDATE animals SET owner_id WITHOUT the GUC is blocked by the trigger; INV-7: species under the GUC still blocked', async () => {
    const animalId = await newAnimal(ownerId);
    // INV-6: no app.ownership_transfer set → trigger raises. Parameterized $queryRaw only (ADR-0007).
    await expect(
      prisma.$executeRaw`UPDATE animals SET owner_id = ${recipId}::uuid WHERE id = ${animalId}::uuid`,
    ).rejects.toThrow(/ownership-transfer workflow/i);

    // INV-7: even WITH the GUC on, immutable species_id/sex still raise (re-attribution path is narrow).
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.ownership_transfer', 'on', true)`;
        await tx.$executeRaw`UPDATE animals SET sex = 'Female' WHERE id = ${animalId}::uuid`;
      }),
    ).rejects.toThrow(/sex cannot be changed/i);

    // Control: WITH the GUC on, the owner change is permitted (proves the GUC is what gates it).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.ownership_transfer', 'on', true)`;
      await tx.$executeRaw`UPDATE animals SET owner_id = ${recipId}::uuid WHERE id = ${animalId}::uuid`;
    });
    const animal = await prisma.animals.findUnique({ where: { id: animalId } });
    expect(animal?.owner_id).toBe(recipId);
  });

  it('org transfer end-to-end: initiate to an org → org-admin accepts → animal org-owned + AOH org interval', async () => {
    const org = await prisma.organizations.create({ data: { name_localized: { en: 'XOrg', ru: 'Орг' }, status: 'ACTIVE' } });
    // strangerId is the org's OWNER (org-admin) — exercises the org branch of assertIsRecipient.
    await prisma.organization_users.create({
      data: { organization_id: org.id, user_id: strangerId, role_in_org: 'OWNER', status: 'ACTIVE' },
    });
    const animalId = await newAnimal(ownerId);
    const xfer = track(await initiate(ownerTok, animalId, { toOrganizationId: org.id }).expect(201));

    // A non-org-admin recipient cannot accept (org branch of INV-8).
    const etag = await getEtag(strangerTok, xfer);
    await request(server()).post(`/v1/transfers/${xfer}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(403);

    // The org-admin (stranger) accepts.
    const accepted = await request(server())
      .post(`/v1/transfers/${xfer}/accept`)
      .set('Authorization', `Bearer ${strangerTok}`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', etag)
      .expect(200);
    expect(accepted.body.status).toBe('COMPLETED');
    expect(accepted.body.toOrganizationId).toBe(org.id);

    const animal = await prisma.animals.findUnique({ where: { id: animalId } });
    expect(animal?.organization_id).toBe(org.id);
    expect(animal?.owner_id).toBeNull();

    // The new AOH interval carries organization_id with owner_id NULL (chk_aoh_owner_party holds).
    const hist = await prisma.animal_ownership_history.findMany({ where: { animal_id: animalId } });
    const open = hist.filter((h) => h.end_date === null);
    expect(open).toHaveLength(1);
    expect(open[0].organization_id).toBe(org.id);
    expect(open[0].owner_id).toBeNull();

    // cleanup org membership + org (animal cleaned by afterAll).
    await prisma.animal_ownership_history.deleteMany({ where: { animal_id: animalId } }).catch(() => undefined);
    await prisma.ownership_transfers.deleteMany({ where: { animal_id: animalId } }).catch(() => undefined);
    await prisma.animals.delete({ where: { id: animalId } }).catch(() => undefined);
    animals.splice(animals.indexOf(animalId), 1);
    await prisma.organization_users.deleteMany({ where: { organization_id: org.id } }).catch(() => undefined);
    await prisma.organizations.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});
