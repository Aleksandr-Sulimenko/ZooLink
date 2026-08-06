/**
 * Agent-auth lifecycle (ADR-0036 issuance + ADR-0037 scoped-ability), end-to-end:
 *   ADMIN issues a credential (plaintext once) → exchange while the master gate is OFF = 403 →
 *   flip gate ON → exchange = short-lived AGENT JWT → the JWT drives the bearer authz path
 *   (scoped agent passes operator-check; a deny-by-default agent is 403) → revoke → 401 →
 *   rotate (old survives the overlap) → expired credential 401 → non-ADMIN issue 403 →
 *   wrong/malformed secret = the SAME uniform 401 → deactivating the agent cascade-revokes.
 *
 * Hostile PG/Redis are localhost; the agent-token rate-limit keys are flushed in beforeAll.
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
import { RedisService } from '../src/lib/redis/redis.service';
import { FeatureToggleService } from '../src/lib/feature-toggle/feature-toggle.service';
import { resetThrottle } from './throttle-reset.util';
import { applyGlobalApiPrefix } from '../src/config/api-base';

const MASTER_GATE = 'agent_service_auth';

interface IssuedBody {
  id: string;
  secret: string;
  capabilityProfileId: number | null;
  rotatedFrom: string | null;
}
interface TokenBody {
  accessToken: string;
  tokenType: string;
}
interface WhoBody {
  principalType: string;
  role: string;
  scope?: Array<{ action: string; subject: string }>;
}

const asIssued = (res: request.Response): IssuedBody => res.body as IssuedBody;
const asToken = (res: request.Response): TokenBody => res.body as TokenBody;
const codeOf = (res: request.Response): string => (res.body as { code: string }).code;

describe('Agent-auth lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let toggles: FeatureToggleService;
  const server = (): Server => app.getHttpServer() as Server;

  const suffix = Date.now().toString(36);
  const admin = { userId: '', role: 'ADMIN' as const, principalType: 'HUMAN' as const };
  let userId: string;
  let agentId: string;
  let agent2Id: string;
  let agent3Id: string;
  let agentAdminId: string;
  let adminTok: string;
  let userTok: string;
  let agentAdminTok: string;
  let moderationProfileId: number;
  const createdCreds: string[] = [];

  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/api/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const issue = (agentUserId: string, tok: string, body: Record<string, unknown> = {}) =>
    request(server())
      .post(`/api/v1/admin/agents/${agentUserId}/credentials`)
      .set('Authorization', `Bearer ${tok}`)
      .send(body);

  const exchange = (credential: string) =>
    request(server()).post('/api/v1/auth/agent/token').send({ credential });

  const setGate = (on: boolean) =>
    toggles.flip(MASTER_GATE, { isEnabled: on, rolloutPercentage: on ? 100 : 0 }, admin);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    applyGlobalApiPrefix(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);
    toggles = app.get(FeatureToggleService);

    // Flush any stale agent-token rate-limit keys from a prior run.
    const redis = app.get(RedisService).client;
    const keys = await redis.keys('agent-token:*');
    if (keys.length) await redis.del(...keys);

    const mk = (n: string, role: string, principal: 'HUMAN' | 'AGENT'): Promise<{ id: string }> =>
      prisma.users.create({ data: { full_name: n, role, principal_type: principal, status: 'ACTIVE', is_active: true } });
    admin.userId = (await mk(`AA-admin-${suffix}`, 'ADMIN', 'HUMAN')).id;
    userId = (await mk(`AA-user-${suffix}`, 'USER', 'HUMAN')).id;
    agentId = (await mk(`AA-agent-${suffix}`, 'MODERATOR', 'AGENT')).id;
    agent2Id = (await mk(`AA-agent2-${suffix}`, 'MODERATOR', 'AGENT')).id;
    agent3Id = (await mk(`AA-agent3-${suffix}`, 'MODERATOR', 'AGENT')).id;
    // An AGENT holding role='ADMIN' (ADR-0011 §7 allows it) — the F1 privilege-escalation pin.
    agentAdminId = (await mk(`AA-agentadmin-${suffix}`, 'ADMIN', 'AGENT')).id;
    [adminTok, userTok, agentAdminTok] = await Promise.all([
      devToken(admin.userId),
      devToken(userId),
      devToken(agentAdminId),
    ]);

    const profile = await prisma.agent_capability_profiles.findUnique({ where: { code: 'moderation-agent' } });
    moderationProfileId = profile!.id;

    await setGate(false); // known clean start
  });

  afterAll(async () => {
    await setGate(false).catch(() => undefined); // reset the shared gate off for sibling suites
    for (const id of createdCreds) {
      await prisma.service_credentials.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.service_credentials
      .deleteMany({ where: { agent_user_id: { in: [agentId, agent2Id, agent3Id, agentAdminId] } } })
      .catch(() => undefined);
    for (const id of [admin.userId, userId, agentId, agent2Id, agent3Id, agentAdminId]) {
      await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  // ── Issuance (HUMAN ADMIN only) ────────────────────────────────────────────────────────────
  it('a non-ADMIN cannot issue a credential (403)', async () => {
    await issue(agentId, userTok, { capabilityProfileId: moderationProfileId }).expect(403);
  });

  it('issuing for a non-AGENT account is rejected (422 TARGET_NOT_AGENT)', async () => {
    const res = await issue(userId, adminTok).expect(422);
    expect(codeOf(res)).toBe('TARGET_NOT_AGENT');
  });

  it('a non-existent capability profile is rejected (422 CAPABILITY_PROFILE_NOT_FOUND)', async () => {
    const res = await issue(agentId, adminTok, { capabilityProfileId: 999999 }).expect(422);
    expect(codeOf(res)).toBe('CAPABILITY_PROFILE_NOT_FOUND');
  });

  // F1 — an AGENT holding role='ADMIN' passes the principal-agnostic RolesGuard but is stopped by the
  // service-layer HUMAN-only guard on ALL THREE mutating endpoints (403 ISSUANCE_HUMAN_ONLY).
  it('an AGENT-ADMIN principal cannot issue / rotate / revoke (403 HUMAN-only)', async () => {
    const dummyCred = '00000000-0000-0000-0000-000000000000';
    const i = await issue(agentId, agentAdminTok, { capabilityProfileId: moderationProfileId }).expect(403);
    expect(codeOf(i)).toBe('ISSUANCE_HUMAN_ONLY');
    await request(server())
      .post(`/api/v1/admin/agents/${agentId}/credentials/${dummyCred}/rotate`)
      .set('Authorization', `Bearer ${agentAdminTok}`)
      .send({})
      .expect(403);
    await request(server())
      .delete(`/api/v1/admin/agents/${agentId}/credentials/${dummyCred}`)
      .set('Authorization', `Bearer ${agentAdminTok}`)
      .expect(403);
  });

  // F3(a) — a non-ADMIN principal is blocked at the coarse RolesGuard on rotate AND revoke too.
  it('a non-ADMIN cannot rotate or revoke a credential (403)', async () => {
    const dummyCred = '00000000-0000-0000-0000-000000000000';
    await request(server())
      .post(`/api/v1/admin/agents/${agentId}/credentials/${dummyCred}/rotate`)
      .set('Authorization', `Bearer ${userTok}`)
      .send({})
      .expect(403);
    await request(server())
      .delete(`/api/v1/admin/agents/${agentId}/credentials/${dummyCred}`)
      .set('Authorization', `Bearer ${userTok}`)
      .expect(403);
  });

  it('ADMIN issues a scoped credential — plaintext secret returned ONCE, only the hash persists', async () => {
    const b = asIssued(await issue(agentId, adminTok, { capabilityProfileId: moderationProfileId, label: 'mod' }).expect(201));
    expect(b.secret).toMatch(/^zlk_agent_[0-9a-f-]{36}_/);
    expect(b.capabilityProfileId).toBe(moderationProfileId);
    createdCreds.push(b.id);

    const row = await prisma.service_credentials.findUnique({ where: { id: b.id } });
    expect(row!.secret_hash).toHaveLength(43); // HMAC base64url, NOT the plaintext token
    expect(b.secret).not.toContain(row!.secret_hash);
    expect(row!.issued_by).toBe(admin.userId);
    expect(row!.capability_profile_id).toBe(moderationProfileId);

    const audit = await prisma.audit_log.findMany({ where: { entity_id: b.id, action: 'agent_credential.issued' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(admin.userId);
    expect(audit[0].actor_principal_type).toBe('HUMAN');
    // the plaintext secret / hash are never logged (only credId + non-secret metadata)
    expect(JSON.stringify(audit[0].after_data)).not.toMatch(/secret/i);
    expect(JSON.stringify(audit[0].after_data)).not.toContain(row!.secret_hash);
  });

  // ── Exchange gate + scoped authz ─────────────────────────────────────────────────────────────
  let scopedSecret: string;
  it('exchange is 403 while the master gate is OFF (no AGENT JWT issued)', async () => {
    const b = asIssued(await issue(agentId, adminTok, { capabilityProfileId: moderationProfileId }).expect(201));
    scopedSecret = b.secret;
    createdCreds.push(b.id);
    const res = await exchange(scopedSecret).expect(403);
    expect(codeOf(res)).toBe('AGENT_AUTH_DISABLED');
  });

  it('with the gate ON, a scoped agent exchanges its secret for an AGENT JWT that drives the bearer authz path', async () => {
    await setGate(true);

    const tok = asToken(await exchange(scopedSecret).expect(200));
    expect(tok.tokenType).toBe('Bearer');
    const agentJwt = tok.accessToken;

    // whoami resolves the source-agnostic AGENT principal, carrying the resolved scope.
    const who = (await request(server()).get('/api/v1/auth/whoami').set('Authorization', `Bearer ${agentJwt}`).expect(200))
      .body as WhoBody;
    expect(who.principalType).toBe('AGENT');
    expect(who.role).toBe('MODERATOR');
    expect(who.scope).toEqual(expect.arrayContaining([{ action: 'read', subject: 'ModerationQueue' }]));

    // operator-check needs role MODERATOR + policy can(read, ModerationQueue) — the scope grants it → 200.
    await request(server()).get('/api/v1/auth/operator-check').set('Authorization', `Bearer ${agentJwt}`).expect(200);
  });

  it('a deny-by-default agent (no profile) exchanges but is denied the scoped operation (403 through PoliciesGuard)', async () => {
    const b = asIssued(await issue(agentId, adminTok).expect(201)); // NO capabilityProfileId → null scope
    createdCreds.push(b.id);
    const agentJwt = asToken(await exchange(b.secret).expect(200)).accessToken;

    const who = (await request(server()).get('/api/v1/auth/whoami').set('Authorization', `Bearer ${agentJwt}`).expect(200))
      .body as WhoBody;
    expect(who.principalType).toBe('AGENT');
    expect(who.scope).toBeUndefined(); // deny-by-default

    // role gate passes (MODERATOR) but the CASL policy has no scope → denied.
    await request(server()).get('/api/v1/auth/operator-check').set('Authorization', `Bearer ${agentJwt}`).expect(403);
  });

  // ── Uniform 401 (no oracle) ────────────────────────────────────────────────────────────────
  it('a wrong secret and a malformed token return the SAME uniform 401', async () => {
    const credId = scopedSecret.slice('zlk_agent_'.length).split('_')[0];
    const wrong = `zlk_agent_${credId}_totallywrongsecretvalue000000000000000000`;
    const bad = await exchange(wrong).expect(401);
    const garbled = await exchange('not-even-a-token').expect(401);
    expect(codeOf(bad)).toBe('INVALID_AGENT_CREDENTIAL');
    expect(codeOf(garbled)).toBe('INVALID_AGENT_CREDENTIAL');
  });

  // ── Revoke ─────────────────────────────────────────────────────────────────────────────────
  it('a revoked credential no longer exchanges (401)', async () => {
    const credId = scopedSecret.slice('zlk_agent_'.length).split('_')[0];
    await request(server())
      .delete(`/api/v1/admin/agents/${agentId}/credentials/${credId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(204);
    expect(codeOf(await exchange(scopedSecret).expect(401))).toBe('INVALID_AGENT_CREDENTIAL');

    const row = await prisma.service_credentials.findUnique({ where: { id: credId } });
    expect(row!.is_active).toBe(false);
    expect(row!.revoked_at).not.toBeNull();
  });

  // ── Rotate (overlap — old survives until separately revoked) ─────────────────────────────────
  it('rotation issues a new working secret and does NOT auto-revoke the old (overlap window)', async () => {
    const old = asIssued(await issue(agentId, adminTok, { capabilityProfileId: moderationProfileId }).expect(201));
    createdCreds.push(old.id);
    await exchange(old.secret).expect(200); // old works

    const rot = asIssued(
      await request(server())
        .post(`/api/v1/admin/agents/${agentId}/credentials/${old.id}/rotate`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({})
        .expect(201),
    );
    createdCreds.push(rot.id);
    expect(rot.rotatedFrom).toBe(old.id);

    await exchange(rot.secret).expect(200); // new works
    await exchange(old.secret).expect(200); // old STILL works (overlap; not auto-revoked)
  });

  // ── Expiry ───────────────────────────────────────────────────────────────────────────────────
  it('an expired credential does not exchange (401)', async () => {
    const b = asIssued(await issue(agentId, adminTok, { capabilityProfileId: moderationProfileId }).expect(201));
    createdCreds.push(b.id);
    await prisma.service_credentials.update({
      where: { id: b.id },
      data: { expires_at: new Date(Date.now() - 60_000) },
    });
    expect(codeOf(await exchange(b.secret).expect(401))).toBe('INVALID_AGENT_CREDENTIAL');
  });

  // ── Cascade on account deactivation (ADR-0036 §4) ────────────────────────────────────────────
  it('deactivating (erasing) the agent account cascade-revokes its live credentials', async () => {
    const b = asIssued(await issue(agent2Id, adminTok, { capabilityProfileId: moderationProfileId }).expect(201));
    createdCreds.push(b.id);
    await exchange(b.secret).expect(200); // live before retirement

    // ADMIN retires the agent account (POST /api/v1/admin/users/{id}/erase → eraseUser).
    await request(server())
      .post(`/api/v1/admin/users/${agent2Id}/erase`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);

    const row = await prisma.service_credentials.findUnique({ where: { id: b.id } });
    expect(row!.is_active).toBe(false);
    expect(row!.revoked_at).not.toBeNull();
    await exchange(b.secret).expect(401);
  });

  // F3(b) — the OTHER deactivate path: self-service deactivation (profile.service.deactivateMe) also
  // cascade-revokes the agent's live credentials in the same tx.
  it('self-deactivating the agent account (profile path) cascade-revokes its live credentials', async () => {
    const b = asIssued(await issue(agent3Id, adminTok, { capabilityProfileId: moderationProfileId }).expect(201));
    createdCreds.push(b.id);
    await exchange(b.secret).expect(200); // live before self-deactivation

    // The agent deactivates its OWN account (POST /api/v1/me → profile.deactivateMe) using its own session.
    const agent3Tok = await devToken(agent3Id);
    await request(server()).post('/api/v1/me').set('Authorization', `Bearer ${agent3Tok}`).expect(200);

    const row = await prisma.service_credentials.findUnique({ where: { id: b.id } });
    expect(row!.is_active).toBe(false);
    expect(row!.revoked_at).not.toBeNull();
    await exchange(b.secret).expect(401);
  });
});
