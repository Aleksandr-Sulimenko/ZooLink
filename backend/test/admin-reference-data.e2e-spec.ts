/**
 * Admin Reference Data (Slice 1) end-to-end against the real stack (PG + Redis). Exercises the
 * full admin-api.yaml reference-data surface: public list/get, ADMIN create/update/toggle, RBAC
 * (USER → 403), validation (breed→species integrity), Idempotency-Key on POST, ETag/If-Match on PATCH.
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

describe('Admin Reference Data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminId: string | undefined;
  let userId: string | undefined;
  let adminToken: string;
  let userToken: string;

  const suffix = Math.random().toString(36).slice(2, 8);
  const speciesCode = `e2e_sp_${suffix}`;
  const breedCode = `e2e_br_${suffix}`;
  let createdSpeciesId: number | undefined;
  let createdBreedId: number | undefined;
  let createdCityId: number | undefined;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> => {
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201);
    return res.body.accessToken as string;
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

    const adminUser = await prisma.users.create({
      data: { full_name: 'RefAdmin', role: 'ADMIN', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    adminId = adminUser.id;
    const normalUser = await prisma.users.create({
      data: { full_name: 'RefUser', role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    userId = normalUser.id;
    adminToken = await devToken(adminId);
    userToken = await devToken(userId);
  });

  afterAll(async () => {
    if (createdBreedId) await prisma.breeds.delete({ where: { id: createdBreedId } }).catch(() => undefined);
    if (createdSpeciesId) await prisma.species.delete({ where: { id: createdSpeciesId } }).catch(() => undefined);
    if (createdCityId) await prisma.cities.delete({ where: { id: createdCityId } }).catch(() => undefined);
    for (const id of [adminId, userId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  it('lists species publicly (no auth) with the standard envelope', async () => {
    const res = await request(server()).get('/v1/reference-data/species').expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 20, total: expect.any(Number) }));
  });

  it('400s on an unknown dataset', async () => {
    await request(server()).get('/v1/reference-data/traits').expect(400);
  });

  it('rejects a create from a normal USER with 403', async () => {
    await request(server())
      .post('/v1/reference-data/species')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ code: speciesCode, nameLocalized: { ru: 'Тест', en: 'Test' } })
      .expect(403);
  });

  it('ADMIN creates a species (201)', async () => {
    const res = await request(server())
      .post('/v1/reference-data/species')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: speciesCode, nameLocalized: { ru: 'Тестовид', en: 'TestSpecies' }, market: 'pet' })
      .expect(201);
    expect(res.body.id).toEqual(expect.any(Number));
    expect(res.body.code).toBe(speciesCode);
    // ADMIN create returns both locales (nameLocalized), no resolved name (API_CONVENTIONS §6).
    expect(res.body.nameLocalized).toEqual({ ru: 'Тестовид', en: 'TestSpecies' });
    expect(res.body.name).toBeNull();
    createdSpeciesId = res.body.id as number;
  });

  it('replays the same Idempotency-Key without creating a duplicate', async () => {
    const key = `idem-${suffix}`;
    const body = { code: `${speciesCode}_idem`, nameLocalized: { ru: 'Идем', en: 'Idem' } };
    const first = await request(server())
      .post('/v1/reference-data/species')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const replay = await request(server())
      .post('/v1/reference-data/species')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await prisma.species.delete({ where: { id: first.body.id as number } }).catch(() => undefined);
  });

  it('rejects a breed referencing a non-existent species (400)', async () => {
    await request(server())
      .post('/v1/reference-data/breeds')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: breedCode, speciesId: 2147483000, nameLocalized: { ru: 'X', en: 'X' } })
      .expect(400);
  });

  it('ADMIN creates a breed under the new species', async () => {
    const res = await request(server())
      .post('/v1/reference-data/breeds')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: breedCode, speciesId: createdSpeciesId, nameLocalized: { ru: 'Тестпорода', en: 'TestBreed' } })
      .expect(201);
    expect(res.body.speciesId).toBe(createdSpeciesId);
    createdBreedId = res.body.id as number;
  });

  it('rejects a code on a city create (400)', async () => {
    await request(server())
      .post('/v1/reference-data/cities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'nope', nameLocalized: { ru: 'Городок', en: 'Town' } })
      .expect(400);
  });

  it('ADMIN creates a city (no code)', async () => {
    const res = await request(server())
      .post('/v1/reference-data/cities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nameLocalized: { ru: `Город ${suffix}`, en: `City ${suffix}` } })
      .expect(201);
    expect(res.body.code).toBeNull();
    createdCityId = res.body.id as number;
  });

  it('public GET by id resolves the name for Accept-Language (en fallback)', async () => {
    const en = await request(server())
      .get(`/v1/reference-data/species/${createdSpeciesId}`)
      .set('Accept-Language', 'en')
      .expect(200);
    expect(en.body.name).toBe('TestSpecies');
    expect(en.body.nameLocalized).toBeNull();

    const ru = await request(server())
      .get(`/v1/reference-data/species/${createdSpeciesId}`)
      .set('Accept-Language', 'ru')
      .expect(200);
    expect(ru.body.name).toBe('Тестовид');
  });

  it('GET by id returns an ETag; PATCH without If-Match is 428; stale is 412; valid succeeds', async () => {
    const get = await request(server())
      .get(`/v1/reference-data/species/${createdSpeciesId}`)
      .expect(200);
    const etag = get.headers['etag'];
    expect(etag).toBeTruthy();

    const body = { nameLocalized: { ru: 'Переименовано', en: 'Renamed' } };
    await request(server())
      .patch(`/v1/reference-data/species/${createdSpeciesId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(428);

    await request(server())
      .patch(`/v1/reference-data/species/${createdSpeciesId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"deadbeef"')
      .send(body)
      .expect(412);

    const patched = await request(server())
      .patch(`/v1/reference-data/species/${createdSpeciesId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', etag)
      .send(body)
      .expect(200);
    // ADMIN PATCH response returns nameLocalized (both locales).
    expect(patched.body.nameLocalized).toEqual({ ru: 'Переименовано', en: 'Renamed' });
  });

  it('toggle-active deactivates then hides from the public active-only list', async () => {
    await request(server())
      .patch(`/v1/reference-data/species/${createdSpeciesId}/toggle-active`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((r) => expect(r.body.isActive).toBe(false));

    const publicList = await request(server())
      .get(`/v1/reference-data/species?limit=100`)
      .expect(200);
    const ids = (publicList.body.items as { id: number }[]).map((i) => i.id);
    expect(ids).not.toContain(createdSpeciesId);

    // ADMIN can still see it with includeInactive
    const adminList = await request(server())
      .get(`/v1/reference-data/species?includeInactive=true&limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const adminIds = (adminList.body.items as { id: number }[]).map((i) => i.id);
    expect(adminIds).toContain(createdSpeciesId);
  });

  it('serves the create-form template to ADMIN', async () => {
    const res = await request(server())
      .get('/v1/reference-data/breeds/new')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.fields).toHaveProperty('speciesId');
    expect(res.body.fields).toHaveProperty('code');
  });
});
