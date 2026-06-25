/**
 * Animal Slice 1 end-to-end against the real stack (PG + Redis). Exercises the full animals-api.yaml
 * surface: create/read/update/list/deactivate/reactivate, RBAC (non-owner → 403), the service-layer
 * invariants (XOR ownership, XOR breed, microchip format/uniqueness, JSONB shape, immutable-field
 * rejection), the DB pedigree trigger surfaced as a clean 422, Idempotency-Key on POST, ETag/If-Match
 * on PATCH, and the agent-as-principal audit path. e2e hits HOST pg/redis (localhost).
 */
import { join } from 'node:path';
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

describe('Animal Slice 1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const created: string[] = [];
  let ownerId: string;
  let otherId: string;
  let adminId: string;
  let modId: string;
  let ownerToken: string;
  let otherToken: string;
  let adminToken: string;
  let modToken: string;

  const suffix = Math.random().toString(36).slice(2, 8);
  let speciesId: number;
  let breedId: number;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> => {
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);

    const mk = (name: string, role: string) =>
      prisma.users.create({ data: { full_name: name, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    ownerId = (await mk('AniOwner', 'USER')).id;
    otherId = (await mk('AniOther', 'USER')).id;
    adminId = (await mk('AniAdmin', 'ADMIN')).id;
    modId = (await mk('AniMod', 'MODERATOR')).id;
    [ownerToken, otherToken, adminToken, modToken] = await Promise.all([
      devToken(ownerId),
      devToken(otherId),
      devToken(adminId),
      devToken(modId),
    ]);

    // Isolated species + breed so FK/pedigree checks are deterministic.
    const sp = await prisma.species.create({
      data: { code: `e2e_sp_${suffix}`, name_localized: { en: 'E2ESpecies', ru: 'Вид' }, market: 'pet' },
    });
    speciesId = sp.id;
    const br = await prisma.breeds.create({
      data: { code: `e2e_br_${suffix}`, species_id: speciesId, name_localized: { en: 'E2EBreed', ru: 'Порода' } },
    });
    breedId = br.id;
  });

  afterAll(async () => {
    for (const id of created) await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of [ownerId, otherId, adminId, modId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  const base = (over: Record<string, unknown> = {}) => ({
    ownerId,
    speciesId,
    breedId,
    nicknameLocalized: { en: 'Rex', ru: 'Рекс' },
    sex: 'Male',
    dateOfBirth: '2021-05-01',
    ...over,
  });

  const create = (token: string, body: Record<string, unknown>) =>
    request(server()).post('/v1/animals').set('Authorization', `Bearer ${token}`).send(body);

  /** Body id as a typed string (avoids `any` leaking into typed args / arrays). */
  const idOf = (res: { body: { id?: unknown } }): string => res.body.id as string;
  /** Track a created animal for cleanup and return its id. */
  const track = (res: { body: { id?: unknown } }): string => {
    const id = idOf(res);
    created.push(id);
    return id;
  };

  it('requires auth (401 without a bearer token)', async () => {
    await request(server()).get('/v1/animals').expect(401);
  });

  it('creates a personal-owned animal (201)', async () => {
    const res = await create(ownerToken, base()).expect(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.ownerId).toBe(ownerId);
    expect(res.body.organizationId).toBeNull();
    expect(res.body.nicknameLocalized).toEqual({ en: 'Rex', ru: 'Рекс' });
    expect(res.body.isActive).toBe(true);
    track(res);
  });

  it('writes an audit_log entry for the create (agent-as-principal machinery)', async () => {
    const res = await create(ownerToken, base({ nicknameLocalized: { en: 'Audited' } })).expect(201);
    track(res);
    const rows = await prisma.audit_log.findMany({ where: { entity_id: res.body.id, action: 'animal.created' } });
    expect(rows.length).toBe(1);
    expect(rows[0].actor_id).toBe(ownerId);
    expect(rows[0].actor_principal_type).toBe('HUMAN');
  });

  it('XOR ownership: rejects both ownerId and organizationId (422)', async () => {
    await create(adminToken, base({ organizationId: ownerId })).expect(422);
  });

  it('XOR ownership: rejects neither (422)', async () => {
    await create(ownerToken, base({ ownerId: undefined })).expect(422);
  });

  it('XOR breed: rejects both breedId and breedTextLocalized (422)', async () => {
    await create(ownerToken, base({ breedTextLocalized: { en: 'Mixed' } })).expect(422);
  });

  it('accepts a custom breed text when breedId is absent (201)', async () => {
    const res = await create(ownerToken, base({ breedId: undefined, breedTextLocalized: { en: 'Mixed', ru: 'Метис' } })).expect(201);
    expect(res.body.breedId).toBeNull();
    expect(res.body.breedTextLocalized).toEqual({ en: 'Mixed', ru: 'Метис' });
    track(res);
  });

  it('microchip: rejects a non-15-digit chip (422)', async () => {
    await create(ownerToken, base({ microchipId: '12345' })).expect(422);
  });

  it('microchip uniqueness: a duplicate 15-digit chip is a clean 409 (not 500)', async () => {
    const chip = String(Date.now()).padStart(15, '0').slice(-15);
    const first = await create(ownerToken, base({ microchipId: chip })).expect(201);
    created.push(idOf(first));
    await create(ownerToken, base({ microchipId: chip })).expect(409);
  });

  it('tattoo uniqueness: a duplicate tattooBrandId is a clean 409 (uq_animals_tattoo)', async () => {
    const tattoo = `T-${suffix}-${Date.now().toString(36)}`;
    const first = await create(ownerToken, base({ tattooBrandId: tattoo })).expect(201);
    created.push(idOf(first));
    await create(ownerToken, base({ tattooBrandId: tattoo })).expect(409);
  });

  it('JSONB: rejects a health record with an unknown key (400 at the validation edge)', async () => {
    // The strict DTO (whitelist + forbidNonWhitelisted) rejects unknown nested keys with 400; the
    // service-layer jsonb shape check is defense-in-depth behind it (covered in the unit suite).
    await create(ownerToken, base({ healthRecords: [{ type: 'vaccination', date: '2024-01-01', bogus: 1 }] })).expect(400);
  });

  it('JSONB: accepts well-formed healthRecords + reproductiveData (201)', async () => {
    const res = await create(
      ownerToken,
      base({
        healthRecords: [{ type: 'vaccination', date: '2024-01-01', note: 'Rabies', vet: 'Dr X' }],
        reproductiveData: [{ event: 'heat', date: '2024-03-01' }],
      }),
    ).expect(201);
    expect(res.body.healthRecords).toHaveLength(1);
    track(res);
  });

  it('pedigree: a same-sex / wrong parent is surfaced as a clean 422 (DB trigger)', async () => {
    // A father must be Male; pass a Female animal as fatherId → trigger RAISE → 422.
    const mother = await create(ownerToken, base({ sex: 'Female', dateOfBirth: '2018-01-01' })).expect(201);
    created.push(idOf(mother));
    await create(ownerToken, base({ dateOfBirth: '2022-01-01', fatherId: mother.body.id })).expect(422);
  });

  it('pedigree: a valid mother/father is accepted (201)', async () => {
    const mother = await create(ownerToken, base({ sex: 'Female', dateOfBirth: '2017-01-01' })).expect(201);
    const father = await create(ownerToken, base({ sex: 'Male', dateOfBirth: '2017-01-01' })).expect(201);
    created.push(idOf(mother), idOf(father));
    const child = await create(
      ownerToken,
      base({ dateOfBirth: '2022-06-01', motherId: mother.body.id, fatherId: father.body.id }),
    ).expect(201);
    expect(child.body.motherId).toBe(mother.body.id);
    created.push(idOf(child));
  });

  it('authz: a USER cannot create an animal owned by someone else (403)', async () => {
    await create(otherToken, base()).expect(403);
  });

  it('Idempotency-Key replays the create without a duplicate', async () => {
    const key = `idem-ani-${suffix}`;
    const body = base({ nicknameLocalized: { en: 'IdemPet' } });
    const first = await request(server())
      .post('/v1/animals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    created.push(idOf(first));
    const replay = await request(server())
      .post('/v1/animals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('GET by id emits an ETag; PATCH without If-Match is 428, stale is 412, valid succeeds', async () => {
    const c = await create(ownerToken, base()).expect(201);
    created.push(idOf(c));
    const get = await request(server())
      .get(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const etag = get.headers['etag'];
    expect(etag).toBeTruthy();

    await request(server())
      .patch(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ colorCoat: 'black' })
      .expect(428);

    await request(server())
      .patch(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('If-Match', 'W/"deadbeef"')
      .send({ colorCoat: 'black' })
      .expect(412);

    const patched = await request(server())
      .patch(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('If-Match', etag)
      .send({ colorCoat: 'black', nicknameLocalized: { en: 'Renamed', ru: 'Переименован' } })
      .expect(200);
    expect(patched.body.colorCoat).toBe('black');
    expect(patched.body.nicknameLocalized.en).toBe('Renamed');
  });

  it('PATCH: an immutable field (speciesId) is rejected with 400 (whitelist)', async () => {
    const c = await create(ownerToken, base()).expect(201);
    created.push(idOf(c));
    const get = await request(server())
      .get(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(server())
      .patch(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('If-Match', get.headers['etag'])
      .send({ speciesId: 2 })
      .expect(400);
  });

  it('authz: a non-owner USER cannot update (403); a MODERATOR can read but not update', async () => {
    const c = await create(ownerToken, base()).expect(201);
    created.push(idOf(c));
    const get = await request(server())
      .get(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${modToken}`)
      .expect(200); // MODERATOR reads any
    await request(server())
      .patch(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('If-Match', get.headers['etag'])
      .send({ colorCoat: 'x' })
      .expect(403);
    await request(server())
      .patch(`/v1/animals/${c.body.id}`)
      .set('Authorization', `Bearer ${modToken}`)
      .set('If-Match', get.headers['etag'])
      .send({ colorCoat: 'x' })
      .expect(403);
  });

  it('deactivate then reactivate, with 409 on a repeat', async () => {
    const c = await create(ownerToken, base()).expect(201);
    created.push(idOf(c));
    const off = await request(server())
      .patch(`/v1/animals/${c.body.id}/deactivate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(off.body.isActive).toBe(false);
    expect(off.body.deactivatedAt).toBeTruthy();

    await request(server())
      .patch(`/v1/animals/${c.body.id}/deactivate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);

    const on = await request(server())
      .patch(`/v1/animals/${c.body.id}/reactivate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(on.body.isActive).toBe(true);
    expect(on.body.deactivatedAt).toBeNull();

    await request(server())
      .patch(`/v1/animals/${c.body.id}/reactivate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);
  });

  it('lists with filters and the standard page envelope', async () => {
    const res = await request(server())
      .get(`/v1/animals?owner_id=${ownerId}&species_id=${speciesId}&sex=Male&limit=100`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 100, total: expect.any(Number) }));
    for (const a of res.body.items as { ownerId: string; sex: string }[]) {
      expect(a.ownerId).toBe(ownerId);
      expect(a.sex).toBe('Male');
    }
  });

  describe('list scoping (IDOR guard — rbac-matrix.md:62/81)', () => {
    let aliceAnimal: string;
    let bobAnimal: string; // owned by `otherId` (user B)

    beforeAll(async () => {
      aliceAnimal = idOf(await create(ownerToken, base({ nicknameLocalized: { en: 'AliceA' } })).expect(201));
      bobAnimal = idOf(
        await create(otherToken, base({ ownerId: otherId, nicknameLocalized: { en: 'BobA' } })).expect(201),
      );
      created.push(aliceAnimal, bobAnimal);
    });

    const ids = (res: { body: { items: { id: string }[] } }): string[] => res.body.items.map((i) => i.id);

    it("an UNSCOPED GET /v1/animals does NOT leak user B's animal to user A", async () => {
      const res = await request(server())
        .get('/v1/animals?limit=100')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const got = ids(res);
      expect(got).toContain(aliceAnimal); // own animal present
      expect(got).not.toContain(bobAnimal); // other principal's animal NOT leaked
      for (const a of res.body.items as { ownerId: string | null }[]) {
        expect(a.ownerId).toBe(ownerId);
      }
    });

    it("a user-supplied owner_id of user B cannot widen scope (still excludes B's animal)", async () => {
      const res = await request(server())
        .get(`/v1/animals?owner_id=${otherId}&limit=100`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(ids(res)).not.toContain(bobAnimal);
    });

    it('MODERATOR (unscoped) DOES see both animals', async () => {
      const res = await request(server())
        .get('/v1/animals?limit=100')
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);
      const got = ids(res);
      expect(got).toEqual(expect.arrayContaining([aliceAnimal, bobAnimal]));
    });

    it('ADMIN (unscoped) DOES see both animals', async () => {
      const res = await request(server())
        .get('/v1/animals?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const got = ids(res);
      expect(got).toEqual(expect.arrayContaining([aliceAnimal, bobAnimal]));
    });
  });
});
