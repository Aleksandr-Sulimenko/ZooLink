/**
 * Identity (phone OTP) end-to-end against the real stack: register → OTP (captured via an
 * overridden SMS provider) → verify → session → authenticated /me-style call. Proves the
 * passwordless flow (spec 01 round-4) over HTTP with PG + Redis.
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
import { SMS_PROVIDER } from '../src/lib/providers';
import type { SmsMessage, SmsSendResult } from '../src/lib/providers';
import { PrismaService } from '../src/lib/db/prisma.service';

describe('Identity phone OTP (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentCodes: string[] = [];
  const phone = `+7999${Math.floor(1000000 + Math.random() * 8999999)}`;
  let createdUserId: string | undefined;

  const capturingSms = {
    sendSms: (msg: SmsMessage): Promise<SmsSendResult> => {
      const m = /(\d{6})/.exec(msg.text);
      if (m) sentCodes.push(m[1]);
      return Promise.resolve({ accepted: true, providerMessageId: null });
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(capturingSms)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdUserId) await prisma.users.delete({ where: { id: createdUserId } }).catch(() => undefined);
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;

  it('rejects an invalid phone with 400', async () => {
    await request(server())
      .post('/v1/auth/register/phone')
      .send({ phone: '123', fullName: 'Ann' })
      .expect(400);
  });

  it('registers (202) and sends a 6-digit OTP', async () => {
    const res = await request(server())
      .post('/v1/auth/register/phone')
      .send({ phone, fullName: 'Ann Tester' })
      .expect(202);
    expect(res.body).toEqual({ status: 'VERIFICATION_REQUIRED', expiresInSeconds: 300 });
    expect(sentCodes).toHaveLength(1);
    expect(sentCodes[0]).toMatch(/^\d{6}$/);
  });

  it('rejects a wrong code with 400', async () => {
    const wrong = sentCodes[0] === '000000' ? '111111' : '000000';
    await request(server())
      .post('/v1/auth/verify-phone')
      .send({ phone, code: wrong })
      .expect(400);
  });

  it('verifies the OTP, activates the account, and issues a usable session', async () => {
    const res = await request(server())
      .post('/v1/auth/verify-phone')
      .send({ phone, code: sentCodes[0] })
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ fullName: 'Ann Tester', role: 'USER', status: 'ACTIVE' });
    expect(res.body.user.phoneHash).toBeUndefined(); // never leak the credential hash
    createdUserId = res.body.user.id as string;

    // the issued access token works on a protected route
    const who = await request(server())
      .get('/v1/auth/whoami')
      .set('Authorization', `Bearer ${res.body.accessToken as string}`)
      .expect(200);
    expect(who.body).toMatchObject({ userId: createdUserId, role: 'USER', principalType: 'HUMAN' });
  });
});
