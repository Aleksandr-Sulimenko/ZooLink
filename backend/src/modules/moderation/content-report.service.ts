import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal, PrincipalType } from '../../lib/auth/principal';
import type { ActorView } from './dto/moderation.dto';
import {
  type ContentReportCreateDto,
  type ContentReportView,
  type ListContentReportsQueryDto,
  MVP_REPORT_ENTITY_TYPES,
  REPORT_TRANSITIONS,
  type ReportStatus,
  type ResolveContentReportDto,
  TERMINAL_REPORT_STATUSES,
} from './dto/content-report.dto';

interface ReportRow {
  id: string;
  reporter_id: string | null;
  entity_type: string;
  entity_id: string;
  reason: string;
  notes: string | null;
  status: string;
  resolved_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Content reports (moderation-api.yaml `/content-reports`, Slice 4b; invariants CR-1..CR-12). Any
 * authenticated user files a report (reporter = the actor, CR-1); a USER reads only their own
 * (listScope, CR-5); MODERATOR|ADMIN resolve (CR-6) via a guarded conditional transition with an
 * in-tx audit + actor/principal snapshot (CR-9, agent-ready). Resolve and the 4a entity-action are
 * decoupled (CR-12). Reuses the proven patterns from the listing/moderation slices.
 */
@Injectable()
export class ContentReportService {
  private readonly logger = new Logger(ContentReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ── File a report (CR-1/CR-2/CR-3/CR-11) ─────────────────────────────────────────────────────
  async create(dto: ContentReportCreateDto, actor: AuthPrincipal): Promise<ContentReportView> {
    // CR-3: MESSAGE is forward-compat form, not available in MVP (ADR-0005, no chat).
    if (!MVP_REPORT_ENTITY_TYPES.has(dto.entityType)) {
      throw new UnprocessableEntityException({ message: 'This entity type cannot be reported in the current version', code: 'ENTITY_TYPE_UNAVAILABLE' });
    }
    // CR-3: the target must exist for its entity_type.
    await this.assertTargetExists(dto.entityType, dto.entityId);

    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.content_reports.create({
          data: {
            reporter_id: actor.userId, // CR-1: server-derived reporter (body reporterId not accepted)
            entity_type: dto.entityType,
            entity_id: dto.entityId,
            reason: dto.reason,
            notes: dto.notes ?? null,
            status: 'OPEN',
          },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'content_report.created',
            entityType: 'content_report',
            entityId: created.id,
            afterData: { entityType: dto.entityType, entityId: dto.entityId, reason: dto.reason },
          },
          tx,
        );
        return created;
      }),
    );
    this.logger.log(`Content report ${row.id} filed by ${actor.userId} on ${dto.entityType}:${dto.entityId}`);
    return this.toView(row);
  }

  // ── List (role-scoped, CR-5) ─────────────────────────────────────────────────────────────────
  async list(query: ListContentReportsQueryDto, actor: AuthPrincipal): Promise<Paginated<ContentReportView>> {
    const where: Prisma.content_reportsWhereInput = {};
    if (query.status !== undefined) where.status = query.status;
    if (query.entity_type !== undefined) where.entity_type = query.entity_type;
    if (query.entity_id !== undefined) where.entity_id = query.entity_id;

    const isOperator = actor.role === 'MODERATOR' || actor.role === 'ADMIN';
    if (isOperator) {
      // reporter_id filter is operator-only.
      if (query.reporter_id !== undefined) where.reporter_id = query.reporter_id;
    } else {
      // CR-5: a USER sees ONLY their own — AND-intersected, can't be widened by a client reporter_id.
      where.reporter_id = actor.userId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.content_reports.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }) as unknown as Promise<ReportRow[]>,
      this.prisma.content_reports.count({ where }),
    ]);
    const principalTypes = await this.resolvePrincipalTypes(rows);
    return paginate(rows.map((r) => this.toView(r, principalTypes)), total, query.page, query.limit);
  }

  // ── Get one (object-scoped, CR-5 — non-owner USER → 404 no-leak) ─────────────────────────────
  async getById(id: string, actor: AuthPrincipal): Promise<{ report: ContentReportView; etag: string }> {
    const row = await this.findRow(id);
    const isOperator = actor.role === 'MODERATOR' || actor.role === 'ADMIN';
    if (!isOperator && row.reporter_id !== actor.userId) {
      // 404, not 403 — don't leak existence (CR-5).
      throw new NotFoundException({ message: 'Content report not found', code: 'NOT_FOUND' });
    }
    const principalTypes = await this.resolvePrincipalTypes([row]);
    return { report: this.toView(row, principalTypes), etag: this.etag(row) };
  }

  // ── Resolve (MOD|ADMIN; If-Match; guarded transition; CR-6..CR-10) ───────────────────────────
  async resolve(
    id: string,
    dto: ResolveContentReportDto,
    ifMatch: string | undefined,
    actor: AuthPrincipal,
  ): Promise<{ report: ContentReportView; etag: string }> {
    const existing = await this.findRow(id);
    assertIfMatch(ifMatch, this.etag(existing)); // CR-10

    const current = existing.status as ReportStatus;
    // CR-8: terminal reports are immutable.
    if (TERMINAL_REPORT_STATUSES.has(current)) {
      throw new ConflictException({ message: 'This report is already resolved (terminal)', code: 'REPORT_TERMINAL' });
    }
    // CR-7: the transition must be legal.
    if (!REPORT_TRANSITIONS[current].has(dto.status)) {
      throw new UnprocessableEntityException({ message: `Cannot move a ${current} report to ${dto.status}`, code: 'VALIDATION_ERROR' });
    }

    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        // Guarded conditional transition (CR-8 concurrency): only a non-terminal report transitions —
        // a concurrent double-resolve has a single winner; the loser rolls back BEFORE the audit write.
        const claim = await tx.content_reports.updateMany({
          where: { id, status: { notIn: ['DISMISSED', 'ACTIONED'] } },
          data: { status: dto.status, resolved_by: actor.userId, updated_at: new Date() },
        });
        if (claim.count !== 1) {
          throw new ConflictException({ message: 'This report is already resolved (terminal)', code: 'REPORT_TERMINAL' });
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: `content_report.${dto.status.toLowerCase()}`,
            entityType: 'content_report',
            entityId: id,
            beforeData: { status: current },
            afterData: { status: dto.status },
          },
          tx,
        );
        return (await tx.content_reports.findUnique({ where: { id } })) as unknown as ReportRow;
      }),
    );
    this.logger.log(`Content report ${id} → ${dto.status} by ${actor.userId}`);
    const principalTypes = await this.resolvePrincipalTypes([row]);
    return { report: this.toView(row, principalTypes), etag: this.etag(row) };
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  private async findRow(id: string): Promise<ReportRow> {
    const row = await this.prisma.content_reports.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ message: 'Content report not found', code: 'NOT_FOUND' });
    return row;
  }

  /** CR-3: the reported target must exist for its entity_type (LISTING|ANIMAL|USER in MVP). */
  private async assertTargetExists(entityType: string, entityId: string): Promise<void> {
    let exists = false;
    if (entityType === 'LISTING') {
      exists = (await this.prisma.listings.findUnique({ where: { id: entityId }, select: { id: true } })) !== null;
    } else if (entityType === 'ANIMAL') {
      exists = (await this.prisma.animals.findUnique({ where: { id: entityId }, select: { id: true } })) !== null;
    } else if (entityType === 'USER') {
      exists = (await this.prisma.users.findUnique({ where: { id: entityId }, select: { id: true } })) !== null;
    }
    if (!exists) {
      throw new NotFoundException({ message: 'The reported entity does not exist', code: 'NOT_FOUND' });
    }
  }

  /**
   * Map DB integrity failures to clean RFC7807 4xx — never a 500. CR-2: a 23505 on the partial-unique
   * `uq_open_report_per_reporter_entity` is a duplicate OPEN report.
   */
  private async runWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'You already have an open report on this item', code: 'DUPLICATE_REPORT' });
      }
      if (
        (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) &&
        /uq_open_report_per_reporter_entity/i.test(err.message)
      ) {
        throw new ConflictException({ message: 'You already have an open report on this item', code: 'DUPLICATE_REPORT' });
      }
      throw err;
    }
  }

  private etag(row: ReportRow): string {
    return weakEtag(`content-report:${row.id}`, row.updated_at);
  }

  /** Batch-resolve the current principal_type of the resolvers for the Actor badge (no N+1). */
  private async resolvePrincipalTypes(rows: ReportRow[]): Promise<Map<string, PrincipalType>> {
    const ids = [...new Set(rows.map((r) => r.resolved_by).filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.users.findMany({ where: { id: { in: ids } }, select: { id: true, principal_type: true } });
    return new Map(users.map((u) => [u.id, u.principal_type as PrincipalType]));
  }

  private toView(row: ReportRow, principalTypes?: Map<string, PrincipalType>): ContentReportView {
    let resolvedBy: ActorView | null = null;
    if (row.resolved_by) {
      resolvedBy = {
        actorId: row.resolved_by,
        principalType: principalTypes?.get(row.resolved_by) ?? 'HUMAN',
        actorDisplayName: null,
      };
    }
    return {
      id: row.id,
      reporterId: row.reporter_id,
      entityType: row.entity_type as ContentReportView['entityType'],
      entityId: row.entity_id,
      reason: row.reason,
      notes: row.notes,
      status: row.status as ContentReportView['status'],
      resolvedBy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
