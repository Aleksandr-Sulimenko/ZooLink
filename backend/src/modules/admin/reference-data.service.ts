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
  type LocalizedString,
  type ReferenceDataEntry,
  type UpdateReferenceDataDto,
} from './dto/reference-data.dto';

/** Languages we resolve to (matches supported_languages active set + §6 en-fallback). */
const SUPPORTED_LANGS = ['ru', 'en'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];
const DEFAULT_LANG: Lang = 'ru'; // users.preferred_language DEFAULT 'ru'

/** A raw lookup row as Prisma returns it (the columns common to species/breeds/cities + optionals). */
interface LookupRow {
  id: number;
  code?: string | null;
  species_id?: number | null;
  name_localized: LocalizedString;
  sort_order: number;
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
  // A3 breeding dictionaries (migration 0019): code + market (ADR-0002), no speciesId.
  health_certifications: { code: true, speciesId: false, market: true },
  genetic_markers: { code: true, speciesId: false, market: true },
};

/**
 * Resolve an Accept-Language header to one of our supported languages (en fallback per §6).
 * Minimal RFC-7231 parse: take the first tag's primary subtag; restrict to ru/en; else DEFAULT_LANG.
 */
export function resolveLang(acceptLanguage: string | undefined): Lang {
  if (!acceptLanguage) return DEFAULT_LANG;
  const primary = acceptLanguage.split(',')[0]?.trim().slice(0, 2).toLowerCase() ?? '';
  return (SUPPORTED_LANGS as readonly string[]).includes(primary)
    ? (primary as Lang)
    : DEFAULT_LANG;
}

/** Resolve a LocalizedString for a language with en fallback then any non-empty (§6 / get_localized). */
function resolveLocalized(value: LocalizedString, lang: Lang): string {
  return value?.[lang] || value?.en || value?.ru || '';
}

/**
 * Reference Data management (Admin Slice 1): CRUD for the three managed lookup tables
 * (species, breeds, cities) per `admin-api.yaml`. Reads are public; mutations are ADMIN-only
 * (RolesGuard at the controller). Localized names are stored as name_localized JSONB {ru,en}
 * (migration 0018): admin reads return both locales (nameLocalized), public reads return the
 * resolved `name` for Accept-Language (API_CONVENTIONS §6). Every mutation is audit-logged with the
 * acting principal (ADR-0006 agent-as-principal). PATCH uses optimistic concurrency (If-Match / ETag).
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

  /**
   * Map a row to the wire entry. `forAdmin` decides the name shape (§6): admin → nameLocalized
   * (both locales), public → resolved `name` for `lang`.
   */
  private toEntry(row: LookupRow, forAdmin: boolean, lang: Lang): ReferenceDataEntry {
    return {
      id: row.id,
      code: row.code ?? null,
      speciesId: row.species_id ?? null,
      name: forAdmin ? null : resolveLocalized(row.name_localized, lang),
      nameLocalized: forAdmin ? row.name_localized : null,
      sortOrder: row.sort_order,
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
    acceptLanguage?: string,
  ): Promise<Paginated<ReferenceDataEntry>> {
    const isAdmin = actor?.role === 'ADMIN';
    const lang = resolveLang(acceptLanguage);
    const where: Record<string, unknown> = {};
    if (!(query.includeInactive && isAdmin)) {
      where.is_active = true;
    }
    if (query.search) {
      const contains = query.search;
      // name_localized is JSONB {ru,en}; filter on the per-locale string paths.
      const or: Record<string, unknown>[] = [
        { name_localized: { path: ['ru'], string_contains: contains } },
        { name_localized: { path: ['en'], string_contains: contains } },
      ];
      if (CAPS[dataset].code) {
        or.push({ code: { contains, mode: 'insensitive' } });
      }
      where.OR = or;
    }

    const delegate = this.delegate(dataset);
    const [rows, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      delegate.count({ where }),
    ]);
    return paginate(rows.map((r) => this.toEntry(r, isAdmin, lang)), total, query.page, query.limit);
  }

  /** GET by id. 404 if missing. Returns the entry + its weak ETag (updated_at-derived). */
  async getById(
    dataset: Dataset,
    id: number,
    actor: AuthPrincipal | undefined,
    acceptLanguage?: string,
  ): Promise<{ entry: ReferenceDataEntry; etag: string }> {
    const row = await this.delegate(dataset).findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ message: 'Reference data entry not found', code: 'NOT_FOUND' });
    const isAdmin = actor?.role === 'ADMIN';
    const lang = resolveLang(acceptLanguage);
    return {
      entry: this.toEntry(row, isAdmin, lang),
      etag: weakEtag(`${dataset}:${row.id}`, row.updated_at),
    };
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
    // Single localized name field (LocalizedString {en, ru}); the editor renders one input per locale.
    fields.nameLocalized = { type: 'localized', label: 'Name', required: true, maxLength: 100 };
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
    fields.sortOrder = { type: 'number', label: 'Sort order', required: false };
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
    // At least one locale must be non-empty (a fully empty name is meaningless).
    if (!dto.nameLocalized.en && !dto.nameLocalized.ru) {
      throw new BadRequestException({ message: 'nameLocalized must have at least one locale', code: 'VALIDATION_ERROR' });
    }

    // Referential integrity: a breed must belong to an existing species (UC-AD-03).
    if (dataset === 'breeds') {
      const parent = await this.prisma.species.findUnique({ where: { id: dto.speciesId } });
      if (!parent) {
        throw new BadRequestException({ message: 'speciesId does not reference an existing species', code: 'VALIDATION_ERROR' });
      }
    }

    const name_localized: LocalizedString = { en: dto.nameLocalized.en, ru: dto.nameLocalized.ru };
    const data: Record<string, unknown> = {
      name_localized,
      sort_order: dto.sortOrder ?? 0,
      is_active: dto.isActive ?? true,
      created_by: actor.userId,
      updated_by: actor.userId,
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
      entityIdInt: row.id, // lookup ids are INT → audit_log.entity_id_int (migration 0018)
      afterData: { dataset, id: row.id, ...data },
    });
    this.logger.log(`Reference data created ${dataset}#${row.id} by ${actor.userId}`);
    return this.toEntry(row, true, DEFAULT_LANG);
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
    if (dto.nameLocalized && !dto.nameLocalized.en && !dto.nameLocalized.ru) {
      throw new BadRequestException({ message: 'nameLocalized must have at least one locale', code: 'VALIDATION_ERROR' });
    }

    const data: Record<string, unknown> = {};
    if (dto.nameLocalized !== undefined) {
      data.name_localized = { en: dto.nameLocalized.en, ru: dto.nameLocalized.ru };
    }
    if (dto.sortOrder !== undefined) data.sort_order = dto.sortOrder;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    if (CAPS[dataset].market && dto.market !== undefined) data.market = dto.market;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({ message: 'No updatable fields provided', code: 'VALIDATION_ERROR' });
    }
    data.updated_by = actor.userId;

    const row = await this.delegate(dataset).update({ where: { id }, data });
    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'reference_data.updated',
      entityType: `reference-data:${dataset}`,
      entityIdInt: id,
      beforeData: {
        dataset,
        id,
        name_localized: existing.name_localized,
        sort_order: existing.sort_order,
        is_active: existing.is_active,
        market: existing.market ?? null,
      },
      afterData: { dataset, id, ...data },
    });
    this.logger.log(`Reference data updated ${dataset}#${id} by ${actor.userId}`);
    return { entry: this.toEntry(row, true, DEFAULT_LANG), etag: weakEtag(`${dataset}:${row.id}`, row.updated_at) };
  }

  /** PATCH toggle-active (ADMIN). Flips is_active; soft-delete instead of row deletion (FK safety). */
  async toggleActive(dataset: Dataset, id: number, actor: AuthPrincipal): Promise<ReferenceDataEntry> {
    const existing = await this.delegate(dataset).findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Reference data entry not found', code: 'NOT_FOUND' });

    const next = !existing.is_active;
    const row = await this.delegate(dataset).update({
      where: { id },
      data: { is_active: next, updated_by: actor.userId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      action: next ? 'reference_data.activated' : 'reference_data.deactivated',
      entityType: `reference-data:${dataset}`,
      entityIdInt: id,
      beforeData: { dataset, id, is_active: existing.is_active },
      afterData: { dataset, id, is_active: next },
    });
    this.logger.log(`Reference data ${next ? 'activated' : 'deactivated'} ${dataset}#${id} by ${actor.userId}`);
    return this.toEntry(row, true, DEFAULT_LANG);
  }
}
