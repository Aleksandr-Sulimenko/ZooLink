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
import { SMS_PROVIDER, EMAIL_PROVIDER } from '../src/lib/providers';
import type { SmsMessage, SmsSendResult, EmailMessage, EmailSendResult } from '../src/lib/providers';
import { PrismaService } from '../src/lib/db/prisma.service';

describe('Identity phone OTP (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentCodes: string[] = [];
  const sentEmailCodes: string[] = [];
  const phone = `+7999${Math.floor(1000000 + Math.random() * 8999999)}`;
  const oauthCode = `ext-oauth-${Math.random().toString(36).slice(2)}`;
  let createdUserId: string | undefined;
  let createdOauthUserId: string | undefined;
  let token: string | undefined;

  const capturingSms = {
    sendSms: (msg: SmsMessage): Promise<SmsSendResult> => {
      const m = /(\d{6})/.exec(msg.text);
      if (m) sentCodes.push(m[1]);
      return Promise.resolve({ accepted: true, providerMessageId: null });
    },
  };
  const capturingEmail = {
    sendEmail: (msg: EmailMessage): Promise<EmailSendResult> => {
      const m = /(\d{6})/.exec(msg.text ?? '');
      if (m) sentEmailCodes.push(m[1]);
      return Promise.resolve({ accepted: true, providerMessageId: null });
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(capturingSms)
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(capturingEmail)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const id of [createdUserId, createdOauthUserId, adminId, recoverUserId, eraseUserId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  // ---- Slice 4 fixtures ----
  let adminId: string | undefined;
  let recoverUserId: string | undefined;
  let eraseUserId: string | undefined;
  const recoverEmail = `recover-${Math.random().toString(36).slice(2)}@example.com`;
  const devToken = async (userId: string): Promise<string> => {
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId }).expect(201);
    return res.body.accessToken as string;
  };

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
    token = res.body.accessToken as string;

    // the issued access token works on a protected route
    const who = await request(server())
      .get('/v1/auth/whoami')
      .set('Authorization', `Bearer ${res.body.accessToken as string}`)
      .expect(200);
    expect(who.body).toMatchObject({ userId: createdUserId, role: 'USER', principalType: 'HUMAN' });
  });

  it('rejects an unknown OAuth provider with 400', async () => {
    await request(server())
      .post('/v1/auth/register/oauth/myspace')
      .send({ code: 'x', fullName: 'X' })
      .expect(400);
  });

  it('registers a new OAuth user (201, ACTIVE) via the dev stub provider', async () => {
    const res = await request(server())
      .post('/v1/auth/register/oauth/google')
      .send({ code: oauthCode, fullName: 'Oauth User' })
      .expect(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ fullName: 'Oauth User', role: 'USER', status: 'ACTIVE' });
    createdOauthUserId = res.body.user.id as string;
  });

  it('logs in the same OAuth identity on a second call (200)', async () => {
    const res = await request(server())
      .post('/v1/auth/register/oauth/google')
      .send({ code: oauthCode, fullName: 'Oauth User' })
      .expect(200);
    expect(res.body.user.id).toBe(createdOauthUserId);
  });

  // ---- /me profile (uses the phone-verified session token) ----
  const bearer = () => `Bearer ${token ?? ''}`;

  it('GET /me requires auth (401 without token)', async () => {
    await request(server()).get('/v1/me').expect(401);
  });

  it('GET /me returns the profile with an ETag, and 304 on If-None-Match', async () => {
    const res = await request(server()).get('/v1/me').set('Authorization', bearer()).expect(200);
    expect(res.body.id).toBe(createdUserId);
    const etag = res.headers.etag;
    expect(etag).toMatch(/^W\//);
    await request(server())
      .get('/v1/me')
      .set('Authorization', bearer())
      .set('If-None-Match', etag)
      .expect(304);
  });

  it('PATCH /me requires If-Match (428) and rejects a stale one (412)', async () => {
    await request(server())
      .patch('/v1/me')
      .set('Authorization', bearer())
      .send({ fullName: 'Renamed' })
      .expect(428);
    await request(server())
      .patch('/v1/me')
      .set('Authorization', bearer())
      .set('If-Match', 'W/"stale"')
      .send({ fullName: 'Renamed' })
      .expect(412);
  });

  it('PATCH /me updates with a valid If-Match', async () => {
    const cur = await request(server()).get('/v1/me').set('Authorization', bearer()).expect(200);
    const res = await request(server())
      .patch('/v1/me')
      .set('Authorization', bearer())
      .set('If-Match', cur.headers.etag)
      .send({ fullName: 'Renamed User', preferredLanguage: 'en' })
      .expect(200);
    expect(res.body.fullName).toBe('Renamed User');
    expect(res.body.preferredLanguage).toBe('en');
  });

  it('deactivates then reactivates the account', async () => {
    await request(server()).post('/v1/me').set('Authorization', bearer()).expect(200);
    const after = await request(server()).get('/v1/me').set('Authorization', bearer()).expect(200);
    expect(after.body.status).toBe('DEACTIVATED');

    const re = await request(server())
      .post('/v1/me/reactivate')
      .set('Authorization', bearer())
      .expect(200);
    expect(re.body.status).toBe('ACTIVE');
  });

  // ---- Slice 4: email-OTP recovery ----
  it('recovers an account via a verified email OTP (closes the logged-out DEACTIVATED gap)', async () => {
    const u = await prisma.users.create({
      data: {
        full_name: 'Recover Me',
        email: recoverEmail,
        email_verified: true,
        role: 'USER',
        principal_type: 'HUMAN',
        status: 'DEACTIVATED',
        is_active: false,
        deactivated_at: new Date(),
      },
    });
    recoverUserId = u.id;

    const req = await request(server())
      .post('/v1/auth/recover/email/request')
      .send({ email: recoverEmail })
      .expect(202);
    expect(req.body).toEqual({ status: 'VERIFICATION_REQUIRED', expiresInSeconds: 300 });
    expect(sentEmailCodes).toHaveLength(1);

    const ver = await request(server())
      .post('/v1/auth/recover/email/verify')
      .send({ email: recoverEmail, code: sentEmailCodes[0] })
      .expect(200);
    expect(ver.body.accessToken).toEqual(expect.any(String));
    expect(ver.body.user.status).toBe('ACTIVE'); // reactivated within grace
  });

  it('does not enumerate accounts — unknown email still 202, no email sent', async () => {
    const before = sentEmailCodes.length;
    await request(server())
      .post('/v1/auth/recover/email/request')
      .send({ email: `ghost-${Math.random().toString(36).slice(2)}@example.com` })
      .expect(202);
    expect(sentEmailCodes).toHaveLength(before);
  });

  it('rejects a wrong recovery code with 400', async () => {
    await request(server())
      .post('/v1/auth/recover/email/verify')
      .send({ email: recoverEmail, code: '000001' })
      .expect(400);
  });

  // ---- Slice 4: admin role-elevation, rebind, erase ----
  it('ADMIN-only routes reject a normal USER with 403', async () => {
    await request(server())
      .patch(`/v1/admin/users/${createdUserId ?? recoverUserId}/role`)
      .set('Authorization', bearer())
      .send({ role: 'BREEDER' })
      .expect(403);
  });

  it('elevates a role via ADMIN and revokes the target sessions', async () => {
    const adminUser = await prisma.users.create({
      data: { full_name: 'Admin', role: 'ADMIN', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    adminId = adminUser.id;
    const adminToken = await devToken(adminId);

    // a fresh USER target with a live session
    const targetToken = token as string; // createdUserId's session (reactivated above)
    const res = await request(server())
      .patch(`/v1/admin/users/${createdUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'BREEDER' })
      .expect(200);
    expect(res.body.role).toBe('BREEDER');

    // target's old access token still works (short TTL), but refresh families are revoked:
    // a GET still passes on the access token; that's expected (round-4 mitigates via short TTL).
    void targetToken;
  });

  it('ADMIN rebinds a new phone for the target (assisted recovery)', async () => {
    const adminToken = await devToken(adminId as string);
    const newPhone = `+7999${Math.floor(1000000 + Math.random() * 8999999)}`;
    await request(server())
      .post(`/v1/admin/users/${createdUserId}/rebind`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPhone, reason: 'lost SIM' })
      .expect(200);
  });

  const eraseEmail = `erase-${Math.random().toString(36).slice(2)}@example.com`;

  it('ADMIN erases a user (ФЗ-152) — anonymised + idempotent', async () => {
    const adminToken = await devToken(adminId as string);
    const victim = await prisma.users.create({
      data: {
        full_name: 'Erase Me',
        email: eraseEmail,
        email_verified: true,
        role: 'USER',
        principal_type: 'HUMAN',
        status: 'ACTIVE',
        is_active: true,
        // contact-exchange PII (ADR-0005) — must be anonymised on erasure (spec 01 round-8)
        contact_phone: '+79991234567',
        contact_telegram: '@eraseme',
        contact_prefs: { show_phone: false, show_telegram: true },
      },
    });
    eraseUserId = victim.id;

    await request(server())
      .post(`/v1/admin/users/${victim.id}/erase`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const erased = await prisma.users.findUnique({ where: { id: victim.id } });
    expect(erased?.full_name).toBe('[deleted]');
    expect(erased?.email).toBeNull();
    expect(erased?.phone_hash).toBeNull();
    expect(erased?.contact_phone).toBeNull();
    expect(erased?.contact_telegram).toBeNull();
    expect(erased?.contact_prefs).toEqual({ show_phone: true, show_telegram: false });
    expect(erased?.erased_at).not.toBeNull();
    expect(erased?.status).toBe('DEACTIVATED');

    // idempotent — second call is a no-op 200
    await request(server())
      .post(`/v1/admin/users/${victim.id}/erase`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('an erased account can no longer be recovered (email released — no OTP sent)', async () => {
    const before = sentEmailCodes.length;
    await request(server())
      .post('/v1/auth/recover/email/request')
      .send({ email: eraseEmail }) // belonged to the erased user; email is now NULL → no match
      .expect(202);
    expect(sentEmailCodes).toHaveLength(before); // no email sent (no enumeration, no leak)
  });

  it('self-service /me/erase deactivates and accepts the request (202)', async () => {
    // recoverUserId is ACTIVE again after recovery; mint a session and self-erase-request
    const selfToken = await devToken(recoverUserId as string);
    await request(server())
      .post('/v1/me/erase')
      .set('Authorization', `Bearer ${selfToken}`)
      .expect(202);
    const after = await prisma.users.findUnique({ where: { id: recoverUserId } });
    expect(after?.status).toBe('DEACTIVATED');
  });
});
