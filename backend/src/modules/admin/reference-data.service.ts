import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import {
  type CreateReferenceDataDto,
  type Dataset,
  type ListReferenceDataQueryDto,
  type ReferenceDataEntry,
  type UpdateReferenceDataDto,
} from './dto/reference-data.dto';

/** A raw lookup row as Prisma returns it (the columns common to species/breeds/cities + optionals). */
interface LookupRow {
  id: number;
  code?: string | null;
  species_id?: number | null;
  name_ru: string;
  name_en: string;
  market?: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Per-dataset capabilities derived from database_schema.sql (round-9 reconciliation). */
const CAPS: Record<Dataset, { code: boolean; speciesId: boolean; market: boolean }> = {
  species: { code: true, speciesId: false, market: true },
  breeds: { code: true, speciesId: true, market: false },
  cities: { code: false, speciesId: false, market: false },
};

/**
 * Reference Data management (Admin Slice 1): CRUD for the three managed lookup tables
 * (species, breeds, cities) per `admin-api.yaml`. Reads are public; mutations are ADMIN-only
 * (RolesGuard at the controller). Every mutation is audit-logged with the acting principal
 * (ADR-0006 agent-as-principal). PATCH uses optimistic concurrency (If-Match / ETag).
 */
@Injectable()
export class ReferenceDataService {
  private readonly logger = new Logger(ReferenceDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Prisma delegate for the dataset (typed as the shared lookup CRUD surface). */
  private delegate(dataset: Dataset): {
    findMany: (args: unknown) => Promise<LookupRow[]>;
    count: (args: unknown) => Promise<number>;
    findUnique: (args: unknown) => Promise<LookupRow | null>;
    create: (args: unknown) => Promise<LookupRow>;
    update: (args: unknown) => Promise<LookupRow>;
  } {
    // The three delegates share the same CRUD method shape; cast narrows to what we use.
    return this.prisma[dataset] as unknown as ReturnType<ReferenceDataService['delegate']>;
  }

  private toEntry(row: LookupRow): ReferenceDataEntry {
    return {
      id: row.id,
      code: row.code ?? null,
      speciesId: row.species_id ?? null,
      name_ru: row.name_ru,
      name_en: row.name_en,
      market: row.market ?? null,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** GET list (public). includeInactive is honoured only for ADMIN; anonymous/non-admin see active only. */
  async list(
    dataset: Dataset,
    query: ListReferenceDataQueryDto,
    actor: AuthPrincipal | undefined,
  ): Promise<Paginated<ReferenceDataEntry>> {
    const isAdmin = actor?.role === 'ADMIN';
    const where: Record<string, unknown> = {};
    if (!(query.includeInactive && isAdmin)) {
      where.is_active = true;
    }
    if (query.search) {
      const contains = query.search;
      const or: Record<string, unknown>[] = [
        { name_ru: { contains, mode: 'insensitive' } },
        { name_en: { contains, mode: 'insensitive' } },
      ];
      if (CAPS[dataset].code) {
        or.push({ code: { contains, mode: 'insensitive' } });
      }
      where.OR = or;
    }

    const delegate = this.delegate(dataset);
    const [rows, total] = await Promise.all([
      delegate.findMany({ where, orderBy: { id: 'asc' }, skip: query.skip, take: query.limit }),
      delegate.count({ where }),
    ]);
    return paginate(rows.map((r) => this.toEntry(r)), total, query.page, query.limit);
  }

  /** GET by id. 404 if missing. Returns the entry + its weak ETag (updated_at-derived). */
  async getById(dataset: Dataset, id: number): Promise<{ entry: ReferenceDataEntry; etag: string }> {
    const row = await this.delegate(dataset).findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ message: 'Reference data entry not found', code: 'NOT_FOUND' });
    return { entry: this.toEntry(row), etag: weakEtag(`${dataset}:${row.id}`, row.updated_at) };
  }

  /** Form/template for the create UI (admin-api.yaml ReferenceDataForm), derived from the dataset's columns. */
  form(dataset: Dataset): { fields: Record<string, unknown> } {
    const caps = CAPS[dataset];
    const fields: Record<string, unknown> = {};
    if (caps.code) {
      fields.code = { type: 'text', label: 'Code', required: true, maxLength: 50, pattern: '^[a-z0-9_]+$' };
    }
    if (caps.speciesId) {
      fields.speciesId = { type: 'number', label: 'Species', required: true };
    }
    fields.name_ru = { type: 'text', label: 'Name (RU)', required: true, maxLength: 100 };
    fields.name_en = { type: 'text', label: 'Name (EN)', required: true, maxLength: 100 };
    if (caps.market) {
      fields.market = {
        type: 'select',
        label: 'Market',
        required: false,
        options: [
          { label: 'Pet', value: 'pet' },
          { label: 'Livestock', value: 'livestock' },
        ],
      };
    }
    fields.isActive = { type: 'boolean', label: 'Active', required: false };
    return { fields };
  }

  /** POST create (ADMIN). Validates per-dataset field applicability + breed→species integrity. */
  async create(
    dataset: Dataset,
    dto: CreateReferenceDataDto,
    actor: AuthPrincipal,
  ): Promise<ReferenceDataEntry> {
    const caps = CAPS[dataset];

    // Reject fields that do not apply to this dataset (mass-assignment / contract clarity).
    if (!caps.code && dto.code !== undefined) {
      throw new BadRequestException({ message: `${dataset} entries have no code`, code: 'VALIDATION_ERROR' });
    }
    if (!caps.speciesId && dto.speciesId !== undefined) {
      throw new BadRequestException({ message: `${dataset} entries have no speciesId`, code: 'VALIDATION_ERROR' });
    }
    if (!caps.market && dto.market !== undefined) {
      throw new BadRequestException({ message: `${dataset} entries have no market`, code: 'VALIDATION_ERROR' });
    }
    if (caps.code && !dto.code) {
      throw new BadRequestException({ message: 'code is required', code: 'VALIDATION_ERROR' });
    }
    if (caps.speciesId && dto.speciesId === undefined) {
      throw new BadRequestException({ message: 'speciesId is required for breeds', code: 'VALIDATION_ERROR' });
    }

    // Referential integrity: a breed must belong to an existing species (UC-AD-03).
    if (dataset === 'breeds') {
      const parent = await this.prisma.species.findUnique({ where: { id: dto.speciesId } });
      if (!parent) {
        throw new BadRequestException({ message: 'speciesId does not reference an existing species', code: 'VALIDATION_ERROR' });
      }
    }

    const data: Record<string, unknown> = {
      name_ru: dto.name_ru,
      name_en: dto.name_en,
      is_active: dto.isActive ?? true,
    };
    if (caps.code) data.code = dto.code;
    if (caps.speciesId) data.species_id = dto.speciesId;
    if (caps.market && dto.market !== undefined) data.market = dto.market;

    let row: LookupRow;
    try {
      row = await this.delegate(dataset).create({ data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'An entry with this code already exists', code: 'CONFLICT' });
      }
      throw err;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'reference_data.created',
      entityType: `reference-data:${dataset}`,
      entityId: null, // lookup ids are INT; audit_log.entity_id is UUID/nullable
      afterData: { dataset, id: row.id, ...data },
    });
    this.logger.log(`Reference data created ${dataset}#${row.id} by ${actor.userId}`);
    return this.toEntry(row);
  }

  /** PATCH update (ADMIN). Optimistic concurrency via If-Match; code/speciesId immutable. */
  async update(
    dataset: Dataset,
    id: number,
    dto: UpdateReferenceDataDto,
    ifMatch: string | undefined,
    actor: AuthPrincipal,
  ): Promise<{ entry: ReferenceDataEntry; etag: string }> {
    const existing = await this.delegate(dataset).findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Reference data entry not found', code: 'NOT_FOUND' });
    assertIfMatch(ifMatch, weakEtag(`${dataset}:${existing.id}`, existing.updated_at));

    if (!CAPS[dataset].market && dto.market !== undefined) {
      throw new BadRequestException({ message: `${dataset} entries have no market`, code: 'VALIDATION_ERROR' });
    }

    const data: Record<string, unknown> = {};
    if (dto.name_ru !== undefined) data.name_ru = dto.name_ru;
    if (dto.name_en !== undefined) data.name_en = dto.name_en;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    if (CAPS[dataset].market && dto.market !== undefined) data.market = dto.market;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({ message: 'No updatable fields provided', code: 'VALIDATION_ERROR' });
    }

    const row = await this.delegate(dataset).update({ where: { id }, data });
    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'reference_data.updated',
      entityType: `reference-data:${dataset}`,
      entityId: null,
      beforeData: { dataset, id, name_ru: existing.name_ru, name_en: existing.name_en, is_active: existing.is_active, market: existing.market ?? null },
      afterData: { dataset, id, ...data },
    });
    this.logger.log(`Reference data updated ${dataset}#${id} by ${actor.userId}`);
    return { entry: this.toEntry(row), etag: weakEtag(`${dataset}:${row.id}`, row.updated_at) };
  }

  /** PATCH toggle-active (ADMIN). Flips is_active; soft-delete instead of row deletion (FK safety). */
  async toggleActive(dataset: Dataset, id: number, actor: AuthPrincipal): Promise<ReferenceDataEntry> {
    const existing = await this.delegate(dataset).findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Reference data entry not found', code: 'NOT_FOUND' });

    const next = !existing.is_active;
    const row = await this.delegate(dataset).update({ where: { id }, data: { is_active: next } });
    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      action: next ? 'reference_data.activated' : 'reference_data.deactivated',
      entityType: `reference-data:${dataset}`,
      entityId: null,
      beforeData: { dataset, id, is_active: existing.is_active },
      afterData: { dataset, id, is_active: next },
    });
    this.logger.log(`Reference data ${next ? 'activated' : 'deactivated'} ${dataset}#${id} by ${actor.userId}`);
    return this.toEntry(row);
  }
}
