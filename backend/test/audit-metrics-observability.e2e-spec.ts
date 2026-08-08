/**
 * AUDIT5 mini-pack A — `zoolink_audit_actions_total` was DEAD FROM BIRTH, and the class of defect
 * behind it. Two things are proven here, end-to-end, over the real module graph:
 *
 *  (1) THE LIVE WITNESS (§Live). Perform a real audited action through HTTP, then SCRAPE /metrics and
 *      see the series with the expected `principal_type`. This is the only acceptable proof: a unit
 *      test holding a hand-made MetricsService passed the whole time the counter was dead, because the
 *      defect was never in AuditMetrics — it was in the WIRING (`AuditModule` injected MetricsService
 *      `@Optional()` and no module made it visible, so it was `undefined` forever). Assertions are
 *      before/after DELTAS, so a leftover series from an earlier run cannot fake a pass.
 *
 *  (2) THE CLASS AXIS (§Class). Not "is the audit counter alive" but "can this defect be born a THIRD
 *      time". The invariant asserted over the booted graph is general:
 *
 *          if an @Optional() dependency's token IS provided somewhere in this process,
 *          then every provider that optional-injects it MUST actually receive it.
 *
 *      A token that is genuinely absent from the process (worker without a metrics registry; Nest's own
 *      `Logger` optional ctor args) stays legally undefined — that is what @Optional() is for. A token
 *      that EXISTS in the process yet is invisible to its consumer is always a wiring gap, i.e. exactly
 *      this bug. Discovery uses Nest's OWN reflection + resolution (`Injector.getClassDependencies` /
 *      `resolveComponentWrapper`) rather than a re-implementation, so it cannot drift from the container,
 *      and it is self-checking: if the sweep stops finding the known AuditMetrics→MetricsService edge,
 *      the suite fails instead of silently passing on an empty set.
 *
 *  (3) THE WORKER SIDE (§Worker). The @Optional() degradation is intentional and must stay real: the
 *      worker graph provides no registry, so the same dependency is undefined there and AuditMetrics is
 *      a no-op — proving the fix did not drag `collectDefaultMetrics` into a process nothing scrapes.
 */
import { join } from 'node:path';
import type { Server } from 'node:http';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

// MUST be set before the app boots: the /metrics guard is fail-closed, and pinning the ops-token path
// keeps the scrape independent of loopback/trust-proxy semantics (which another pack is changing).
process.env.METRICS_TOKEN = 'audit-metrics-e2e-secret';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication, InjectionToken } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { Injector } from '@nestjs/core/injector/injector';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker.module';
import { ProblemExceptionFilter } from '../src/lib/http/problem.filter';
import { PrismaService } from '../src/lib/db/prisma.service';
import { AuditLogService } from '../src/lib/audit/audit-log.service';
import { AuditMetrics } from '../src/lib/audit/audit.metrics';
import { MetricsService } from '../src/lib/metrics/metrics.service';
import { applyGlobalApiPrefix } from '../src/config/api-base';
import { resetThrottle } from './throttle-reset.util';

const METRIC = 'zoolink_audit_actions_total';

/** One @Optional() constructor dependency of one class provider, as the real container sees it. */
interface OptionalDep {
  module: string;
  provider: string;
  index: number;
  tokenName: string;
  /** Is this token provided ANYWHERE in this process's graph? */
  providedInProcess: boolean;
  /** Did the container actually hand an instance to THIS consumer? */
  resolved: boolean;
}

function tokenName(token: InjectionToken): string {
  if (typeof token === 'function') return token.name;
  return String(token);
}

function isProvidedInProcess(modules: ModulesContainer, token: InjectionToken): boolean {
  for (const moduleRef of modules.values()) {
    if (moduleRef.providers.has(token)) return true;
  }
  return false;
}

/**
 * Walk every class provider in the graph and report its @Optional() constructor dependencies, using
 * the container's own reflection and lookup. Factory providers are skipped (`wrapper.inject` set):
 * their optional deps are declared as `{ token, optional }` entries, a different mechanism than the
 * `@Optional()` decorator this axis is about.
 */
async function sweepOptionalDeps(modules: ModulesContainer): Promise<OptionalDep[]> {
  const injector = new Injector();
  const found: OptionalDep[] = [];

  for (const hostModule of modules.values()) {
    for (const wrapper of hostModule.providers.values()) {
      if (typeof wrapper.metatype !== 'function' || wrapper.inject != null) continue;
      const [dependencies, optionalIndexes] = injector.getClassDependencies(wrapper);

      for (const index of optionalIndexes) {
        const token = dependencies[index];
        if (token === undefined) continue;
        let resolved = false;
        try {
          const resolvedWrapper = await injector.resolveComponentWrapper(
            hostModule,
            token,
            { index, dependencies },
            wrapper,
          );
          resolved = resolvedWrapper.instance !== undefined && resolvedWrapper.instance !== null;
        } catch {
          resolved = false; // UnknownDependenciesException — nothing to inject at this index.
        }
        found.push({
          module: hostModule.metatype.name,
          provider: String(wrapper.name),
          index,
          tokenName: tokenName(token),
          providedInProcess: isProvidedInProcess(modules, token),
          resolved,
        });
      }
    }
  }
  return found;
}

/** Value of one Prometheus series in a scrape body, or 0 when the series is absent. */
function seriesValue(body: string, metric: string, labels: Record<string, string>): number {
  const required = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  for (const line of body.split('\n')) {
    if (!line.startsWith(`${metric}{`)) continue;
    if (!required.every((pair) => line.includes(pair))) continue;
    const value = Number(line.slice(line.lastIndexOf('}') + 1).trim());
    if (!Number.isNaN(value)) return value;
  }
  return 0;
}

describe('Audit observability wiring (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminId: string;
  let agentId: string;
  let adminToken: string;

  const suffix = Math.random().toString(36).slice(2, 8);
  const settingKey = `e2e_auditmetrics_${suffix}`;
  const agentAction = `listing.reject.e2e_${suffix}`;

  const server = (): Server => app.getHttpServer() as Server;

  const scrape = async (): Promise<string> => {
    const res = await request(server())
      .get('/metrics')
      .set('X-Metrics-Token', 'audit-metrics-e2e-secret')
      .expect(200);
    return res.text;
  };

  /** The real client loop: GET the setting, read its ETag (the PATCH's If-Match validator), flip it. */
  const flipSetting = async (isEnabled: boolean): Promise<void> => {
    const get = await request(server())
      .get(`/api/v1/system/settings/${settingKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(server())
      .patch(`/api/v1/system/settings/${settingKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', get.headers['etag'])
      .send({ value: JSON.stringify({ isEnabled, rolloutPercentage: isEnabled ? 100 : 0 }) })
      .expect(200);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ProblemExceptionFilter());
    applyGlobalApiPrefix(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);

    const admin = await prisma.users.create({
      data: {
        full_name: `AuditMetricsAdmin_${suffix}`,
        role: 'ADMIN',
        principal_type: 'HUMAN',
        status: 'ACTIVE',
        is_active: true,
      },
    });
    adminId = admin.id;
    // ADR-0006: an operator principal may be an AI agent. A real AGENT user, not a relabelled human.
    const agent = await prisma.users.create({
      data: {
        full_name: `AuditMetricsAgent_${suffix}`,
        role: 'MODERATOR',
        principal_type: 'AGENT',
        status: 'ACTIVE',
        is_active: true,
      },
    });
    agentId = agent.id;

    const tokenRes = await request(server())
      .post('/api/v1/auth/dev-token')
      .send({ userId: adminId })
      .expect(201);
    adminToken = tokenRes.body.accessToken as string;

    await prisma.feature_toggles.create({
      data: {
        key: settingKey,
        description: 'e2e audit-metrics witness',
        is_enabled: false,
        rollout_percentage: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.feature_toggles.delete({ where: { key: settingKey } }).catch(() => undefined);
    // audit_log rows stay: the ledger is append-only (trg_audit_log_append_only). The FK is
    // ON DELETE SET NULL, so removing the actors does not orphan the trail.
    for (const id of [agentId, adminId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
    delete process.env.METRICS_TOKEN;
  });

  describe('Live: an audited action shows up on /metrics', () => {
    it('a real ADMIN action increments zoolink_audit_actions_total{principal_type="HUMAN"}', async () => {
      const labels = { principal_type: 'HUMAN', action: 'feature_toggle.flip' };
      const before = seriesValue(await scrape(), METRIC, labels);

      await flipSetting(true);

      const after = seriesValue(await scrape(), METRIC, labels);
      expect(after).toBe(before + 1);
      // The series must genuinely exist (a before/after of 0→0 would also satisfy a naive delta).
      expect(after).toBeGreaterThanOrEqual(1);
    });

    it('exposes the metric with its HELP/TYPE metadata (it is registered, not just written)', async () => {
      const body = await scrape();
      expect(body).toContain(`# HELP ${METRIC} `);
      expect(body).toContain(`# TYPE ${METRIC} counter`);
    });

    it('separates an AGENT principal into its own series (ADR-0006 human-vs-agent split)', async () => {
      const agentLabels = { principal_type: 'AGENT', action: agentAction };
      const humanLabels = { principal_type: 'HUMAN', action: 'feature_toggle.flip' };
      const beforeAgent = seriesValue(await scrape(), METRIC, agentLabels);
      const beforeHuman = seriesValue(await scrape(), METRIC, humanLabels);

      // Recorded through the app's OWN AuditLogService instance (real graph, real append-only insert).
      // Not driven over HTTP because an AGENT-authenticated moderation call would additionally require
      // the agent_service_auth + agent_moderation toggles; the label plumbing is what this asserts.
      await app.get(AuditLogService).record({
        actorId: agentId,
        actorRole: 'MODERATOR',
        actorPrincipalType: 'AGENT',
        action: agentAction,
        entityType: 'listing',
      });

      const body = await scrape();
      expect(seriesValue(body, METRIC, agentLabels)).toBe(beforeAgent + 1);
      // The HUMAN series is untouched — the split is real, not one counter with a cosmetic label.
      expect(seriesValue(body, METRIC, humanLabels)).toBe(beforeHuman);
    });

    it('reports itself wired in the API process (no silent no-op)', () => {
      expect(app.get(AuditMetrics).isWired).toBe(true);
    });
  });

  describe('Class: @Optional() dependencies that EXIST in the process are actually injected', () => {
    it('finds the AuditMetrics -> MetricsService edge (self-check: the sweep must not be empty)', async () => {
      const deps = await sweepOptionalDeps(app.get(ModulesContainer));
      const edge = deps.find(
        (d) => d.provider === AuditMetrics.name && d.tokenName === MetricsService.name,
      );
      expect(edge).toBeDefined();
      expect(edge?.providedInProcess).toBe(true);
      expect(edge?.resolved).toBe(true);
    });

    it('leaves no @Optional() dependency unresolved whose token is provided in this process', async () => {
      const deps = await sweepOptionalDeps(app.get(ModulesContainer));
      const dead = deps.filter((d) => d.providedInProcess && !d.resolved);
      // Message names the exact wiring gap, because that is the whole cost of this defect class.
      expect(
        dead.map((d) => `${d.module}::${d.provider}[${d.index}] cannot see ${d.tokenName}`),
      ).toEqual([]);
    });
  });

  describe('Worker: the @Optional() degradation stays real', () => {
    it('provides no metrics registry, so audit metrics are a documented no-op there', async () => {
      const workerRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
      try {
        const modules = workerRef.get(ModulesContainer);
        expect(isProvidedInProcess(modules, MetricsService)).toBe(false);
        expect(workerRef.get(AuditMetrics).isWired).toBe(false);

        const deps = await sweepOptionalDeps(modules);
        const edge = deps.find(
          (d) => d.provider === AuditMetrics.name && d.tokenName === MetricsService.name,
        );
        expect(edge?.resolved).toBe(false);
        // Same invariant as the API graph: absent is fine, present-but-invisible is not.
        expect(deps.filter((d) => d.providedInProcess && !d.resolved)).toEqual([]);
      } finally {
        await workerRef.close();
      }
    });
  });
});
