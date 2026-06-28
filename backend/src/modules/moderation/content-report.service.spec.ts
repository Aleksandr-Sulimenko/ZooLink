import { ConflictException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContentReportService } from './content-report.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import { weakEtag } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { ContentReportCreateDto } from './dto/content-report.dto';

const REPORTER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const MOD = '33333333-3333-3333-3333-333333333333';
const ENTITY = '44444444-4444-4444-4444-444444444444';
const REPORT = '55555555-5555-5555-5555-555555555555';
const UPDATED = new Date('2026-06-28T00:00:00Z');

const p = (id: string, role: AuthPrincipal['role'] = 'USER', pt: AuthPrincipal['principalType'] = 'HUMAN'): AuthPrincipal => ({ userId: id, role, principalType: pt });

function reportRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REPORT,
    reporter_id: REPORTER,
    entity_type: 'LISTING',
    entity_id: ENTITY,
    reason: 'SPAM',
    notes: null,
    status: 'OPEN',
    resolved_by: null,
    created_at: new Date('2026-06-28T00:00:00Z'),
    updated_at: UPDATED,
    ...over,
  };
}

interface SetupOpts {
  report?: Record<string, unknown> | null;
  targetExists?: boolean;
  resolveCount?: number;
}

function setup(opts: SetupOpts = {}) {
  const report = 'report' in opts ? opts.report : reportRow();
  const crCreate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve(reportRow(args.data)));
  const crUpdateMany = jest.fn().mockResolvedValue({ count: opts.resolveCount ?? 1 });
  const content_reports = {
    findUnique: jest.fn().mockResolvedValue(report),
    findMany: jest.fn().mockResolvedValue(report ? [report] : []),
    count: jest.fn().mockResolvedValue(report ? 1 : 0),
    create: crCreate,
    updateMany: crUpdateMany,
  };
  const targetExists = opts.targetExists ?? true;
  const found = targetExists ? { id: ENTITY } : null;
  const prisma = {
    content_reports,
    listings: { findUnique: jest.fn().mockResolvedValue(found) },
    animals: { findUnique: jest.fn().mockResolvedValue(found) },
    users: { findUnique: jest.fn().mockResolvedValue(found), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb({ content_reports })),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const svc = new ContentReportService(prisma, audit);
  return { svc, content_reports, crCreate, crUpdateMany, record };
}

const create = (over: Partial<ContentReportCreateDto> = {}): ContentReportCreateDto => ({ entityType: 'LISTING', entityId: ENTITY, reason: 'SPAM', ...over });
const etagOf = (): string => weakEtag(`content-report:${REPORT}`, UPDATED);

describe('ContentReportService', () => {
  describe('create — CR-1/CR-2/CR-3', () => {
    it('CR-1: files a report with reporter derived from the actor + audits', async () => {
      const { svc, crCreate, record } = setup({ report: null });
      const out = await svc.create(create(), p(REPORTER));
      expect(out.status).toBe('OPEN');
      expect(crCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reporter_id: REPORTER }) }));
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'content_report.created' }), expect.anything());
    });

    it('CR-3: a MESSAGE report → 422 ENTITY_TYPE_UNAVAILABLE', async () => {
      const { svc } = setup({ report: null });
      const err = await svc.create(create({ entityType: 'MESSAGE' }), p(REPORTER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'ENTITY_TYPE_UNAVAILABLE' });
    });

    it('CR-3: a report on a non-existent target → 404', async () => {
      const { svc } = setup({ report: null, targetExists: false });
      await expect(svc.create(create(), p(REPORTER))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('CR-2: a duplicate OPEN report (23505) → 409 DUPLICATE_REPORT', async () => {
      const { svc, crCreate } = setup({ report: null });
      crCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6', meta: { target: 'uq_open_report_per_reporter_entity' } }));
      const err = await svc.create(create(), p(REPORTER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'DUPLICATE_REPORT' });
    });
  });

  describe('getById — CR-5 object-scope', () => {
    it('the reporter sees their own report (+ ETag)', async () => {
      const { svc } = setup();
      const { report, etag } = await svc.getById(REPORT, p(REPORTER));
      expect(report.id).toBe(REPORT);
      expect(etag).toBe(etagOf());
    });

    it('CR-5: a non-owner USER → 404 (no existence leak)', async () => {
      const { svc } = setup();
      await expect(svc.getById(REPORT, p(OTHER))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a MODERATOR may read any report', async () => {
      const { svc } = setup();
      await expect(svc.getById(REPORT, p(MOD, 'MODERATOR'))).resolves.toBeDefined();
    });

    it('404 when the report is absent', async () => {
      const { svc } = setup({ report: null });
      await expect(svc.getById(REPORT, p(REPORTER))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list — CR-5 read-scope', () => {
    const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, skip: 0, ...over }) as never;

    it('a USER is force-scoped to their own reports (a client reporter_id cannot widen)', async () => {
      const { svc, content_reports } = setup();
      await svc.list(q({ reporter_id: OTHER }), p(REPORTER));
      const arg = content_reports.findMany.mock.calls[0][0] as { where: { reporter_id: string } };
      expect(arg.where.reporter_id).toBe(REPORTER); // not OTHER
    });

    it('an operator may filter by any reporter_id', async () => {
      const { svc, content_reports } = setup();
      await svc.list(q({ reporter_id: OTHER }), p(MOD, 'MODERATOR'));
      const arg = content_reports.findMany.mock.calls[0][0] as { where: { reporter_id?: string } };
      expect(arg.where.reporter_id).toBe(OTHER);
    });
  });

  describe('resolve — CR-6..CR-10', () => {
    it('resolves OPEN → REVIEWED with matching If-Match; sets resolved_by + audits', async () => {
      const { svc, content_reports, record } = setup();
      const { report } = await svc.resolve(REPORT, { status: 'REVIEWED' }, etagOf(), p(MOD, 'MODERATOR'));
      expect(content_reports.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: REPORT, status: { notIn: ['DISMISSED', 'ACTIONED'] } }, data: expect.objectContaining({ status: 'REVIEWED', resolved_by: MOD }) }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'content_report.reviewed' }), expect.anything());
      expect(report).toBeDefined();
    });

    it('CR-10: missing If-Match → 428; stale → 412', async () => {
      const { svc } = setup();
      expect((await svc.resolve(REPORT, { status: 'REVIEWED' }, undefined, p(MOD, 'MODERATOR')).catch((e: unknown) => e) as HttpException).getStatus()).toBe(428);
      expect((await svc.resolve(REPORT, { status: 'REVIEWED' }, 'W/"x"', p(MOD, 'MODERATOR')).catch((e: unknown) => e) as HttpException).getStatus()).toBe(412);
    });

    it('CR-8: resolve on a terminal (DISMISSED) report → 409 REPORT_TERMINAL', async () => {
      const { svc } = setup({ report: reportRow({ status: 'DISMISSED' }) });
      const err = await svc.resolve(REPORT, { status: 'ACTIONED' }, etagOf(), p(MOD, 'MODERATOR')).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'REPORT_TERMINAL' });
    });

    it('CR-7: an illegal transition (REVIEWED → REVIEWED is not allowed) → 422', async () => {
      const { svc } = setup({ report: reportRow({ status: 'REVIEWED' }) });
      // REVIEWED may only go to DISMISSED/ACTIONED; REVIEWED→REVIEWED is illegal.
      const err = await svc.resolve(REPORT, { status: 'REVIEWED' }, etagOf(), p(MOD, 'MODERATOR')).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('REVIEWED → ACTIONED is legal', async () => {
      const { svc } = setup({ report: reportRow({ status: 'REVIEWED' }) });
      await expect(svc.resolve(REPORT, { status: 'ACTIONED' }, etagOf(), p(MOD, 'MODERATOR'))).resolves.toBeDefined();
    });

    it('CR-8 concurrency: the guarded transition returns count 0 → 409 REPORT_TERMINAL, no audit (loser writes nothing)', async () => {
      const { svc, record } = setup({ resolveCount: 0 });
      const err = await svc.resolve(REPORT, { status: 'REVIEWED' }, etagOf(), p(MOD, 'MODERATOR')).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'REPORT_TERMINAL' });
      expect(record).not.toHaveBeenCalled();
    });

    it('CR-12: resolve carries no entity-action field (decoupled) — only status/resolved_by are written', async () => {
      const { svc, crUpdateMany } = setup();
      await svc.resolve(REPORT, { status: 'ACTIONED' }, etagOf(), p(MOD, 'MODERATOR'));
      const data = (crUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(Object.keys(data).sort()).toEqual(['resolved_by', 'status', 'updated_at']);
    });
  });
});
