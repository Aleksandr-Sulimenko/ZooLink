import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { subject } from '@casl/ability';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { AbilityFactory } from '../../lib/auth/ability.factory';
import { assertCan } from '../../lib/auth/policies.guard';
import { paginate, type Paginated } from '../../lib/pagination/page';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import {
  type AnimalCreateDto,
  type AnimalListQueryDto,
  type AnimalUpdateDto,
  type AnimalView,
  type LocalizedString,
} from './dto/animal.dto';

/** A raw `animals` row, narrowed to the columns this slice reads/maps. */
interface AnimalRow {
  id: string;
  owner_id: string | null;
  organization_id: string | null;
  species_id: number;
  breed_id: number | null;
  breed_text_localized: unknown;
  nickname_localized: unknown;
  sex: string;
  date_of_birth: Date;
  color_coat: string | null;
  description_localized: unknown;
  microchip_id: string | null;
  tattoo_brand_id: string | null;
  is_active: boolean;
  owned_since: Date | null;
  mother_id: string | null;
  father_id: string | null;
  health_records: unknown;
  reproductive_data: unknown;
  created_at: Date;
  updated_at: Date;
  deactivated_at: Date | null;
}

/** ISO-11784/85 microchip = exactly 15 digits (spec line 109, service-validated). */
const MICROCHIP_RE = /^\d{15}$/;
/** Allowed item keys per JSONB array contract (spec lines 103–104), used to reject unknown keys. */
const HEALTH_KEYS = new Set(['type', 'date', 'note', 'vet']);
const REPRO_KEYS = new Set(['event', 'date', 'details']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Animal aggregate CRUD (animals-api.yaml, Animal Slice 1; ADR-0004 animal-as-aggregate). Reuses the
 * platform foundation: RFC7807 errors, page/limit pagination, ETag/If-Match, audit (agent-as-principal).
 *
 * Invariant ownership is layered: the service enforces the business rules (XOR ownership, XOR breed,
 * microchip format/uniqueness, JSONB array shape, immutable fields, authz) with clean 4xx errors
 * BEFORE the DB constraints/triggers fire; the DB (chk_animal_ownership, chk_animals_breed_dep,
 * uq_animals_*, trg_enforce_pedigree_integrity) is the last line of defence — a 23505 or a pedigree
 * RAISE EXCEPTION is mapped to a clean 409/422, never a 500.
 */
@Injectable()
export class AnimalService {
  private readonly logger = new Logger(AnimalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly abilities: AbilityFactory,
  ) {}

  /** POST /animals — create. Validates all service-layer invariants, then inserts + audits atomically. */
  async create(dto: AnimalCreateDto, actor: AuthPrincipal): Promise<AnimalView> {
    this.assertOwnershipXor(dto.ownerId, dto.organizationId);
    this.assertBreedXor(dto.breedId, dto.breedTextLocalized);

    const nickname = this.normalizeLocalized(dto.nicknameLocalized);
    if (!nickname.en && !nickname.ru) {
      throw new UnprocessableEntityException({
        message: 'nicknameLocalized must have at least one non-empty locale',
        code: 'VALIDATION_ERROR',
      });
    }
    this.assertMicrochipFormat(dto.microchipId);
    const healthRecords = this.validateHealthRecords(dto.healthRecords);
    const reproductiveData = this.validateReproductiveData(dto.reproductiveData);

    // Authz (rbac-matrix.md): a USER may create only an Animal they will own (CASL keys on owner_id);
    // an org-owned Animal requires org-admin of organizationId (not expressible in the static CASL map,
    // so checked directly). ADMIN has operator scope over both paths.
    if (dto.organizationId) {
      await this.assertOrgAdmin(actor, dto.organizationId);
    } else {
      const ability = this.abilities.createForPrincipal(actor);
      assertCan(ability, 'create', subject('Animal', { owner_id: dto.ownerId ?? null }));
    }

    const data: Prisma.animalsUncheckedCreateInput = {
      owner_id: dto.ownerId ?? null,
      organization_id: dto.organizationId ?? null,
      species_id: dto.speciesId,
      breed_id: dto.breedId ?? null,
      // breed_text_localized is a nullable JSONB in an XOR check with breed_id → SQL NULL (Prisma.DbNull),
      // NOT a JSON `null` (Prisma.JsonNull), or chk_animals_breed_dep would see a non-NULL value.
      breed_text_localized: dto.breedTextLocalized
        ? (this.normalizeLocalized(dto.breedTextLocalized) as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      nickname_localized: nickname as unknown as Prisma.InputJsonValue,
      sex: dto.sex,
      date_of_birth: this.toDate(dto.dateOfBirth),
      color_coat: dto.colorCoat ?? null,
      description_localized: this.normalizeLocalized(dto.descriptionLocalized) as unknown as Prisma.InputJsonValue,
      microchip_id: dto.microchipId ?? null,
      tattoo_brand_id: dto.tattooBrandId ?? null,
      owned_since: dto.ownedSince ? this.toDate(dto.ownedSince) : null,
      mother_id: dto.motherId ?? null,
      father_id: dto.fatherId ?? null,
      health_records: healthRecords as unknown as Prisma.InputJsonValue,
      reproductive_data: reproductiveData as unknown as Prisma.InputJsonValue,
      is_active: dto.isActive ?? true,
    };

    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const created = (await tx.animals.create({ data })) as unknown as AnimalRow;
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'animal.created',
            entityType: 'animal',
            entityId: created.id,
            afterData: this.auditSnapshot(created),
          },
          tx,
        );
        return created;
      }),
    );

    this.logger.log(`Animal created ${row.id} by ${actor.userId}`);
    return this.toView(row);
  }

  /** GET /animals/{id} — read one + its weak ETag. 404 if absent. Read authz is open to all roles (matrix). */
  async getById(id: string, actor: AuthPrincipal): Promise<{ animal: AnimalView; etag: string }> {
    const row = await this.findOrThrow(id);
    const ability = this.abilities.createForPrincipal(actor);
    assertCan(ability, 'read', subject('Animal', this.aclSubject(row)));
    return { animal: this.toView(row), etag: this.etag(row) };
  }

  /** PATCH /animals/{id} — mutable fields only, If-Match required (428 missing / 412 stale). */
  async update(
    id: string,
    dto: AnimalUpdateDto,
    ifMatch: string | undefined,
    actor: AuthPrincipal,
  ): Promise<{ animal: AnimalView; etag: string }> {
    const existing = await this.findOrThrow(id);
    await this.assertCanMutate(actor, existing);
    assertIfMatch(ifMatch, this.etag(existing));

    this.assertMicrochipFormat(dto.microchipId);

    const data: Prisma.animalsUncheckedUpdateInput = {};
    if (dto.nicknameLocalized !== undefined) {
      const nickname = this.normalizeLocalized(dto.nicknameLocalized);
      if (!nickname.en && !nickname.ru) {
        throw new UnprocessableEntityException({
          message: 'nicknameLocalized must have at least one non-empty locale',
          code: 'VALIDATION_ERROR',
        });
      }
      data.nickname_localized = nickname as unknown as Prisma.InputJsonValue;
    }
    if (dto.descriptionLocalized !== undefined) {
      data.description_localized = this.normalizeLocalized(dto.descriptionLocalized) as unknown as Prisma.InputJsonValue;
    }
    if (dto.colorCoat !== undefined) data.color_coat = dto.colorCoat;
    if (dto.microchipId !== undefined) data.microchip_id = dto.microchipId;
    if (dto.tattooBrandId !== undefined) data.tattoo_brand_id = dto.tattooBrandId;
    if (dto.healthRecords !== undefined) {
      data.health_records = this.validateHealthRecords(dto.healthRecords) as unknown as Prisma.InputJsonValue;
    }
    if (dto.reproductiveData !== undefined) {
      data.reproductive_data = this.validateReproductiveData(dto.reproductiveData) as unknown as Prisma.InputJsonValue;
    }
    if (dto.ownedSince !== undefined) data.owned_since = dto.ownedSince ? this.toDate(dto.ownedSince) : null;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({ message: 'No updatable fields provided', code: 'VALIDATION_ERROR' });
    }
    data.updated_at = new Date();

    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = (await tx.animals.update({ where: { id }, data })) as unknown as AnimalRow;
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'animal.updated',
            entityType: 'animal',
            entityId: id,
            beforeData: this.auditSnapshot(existing),
            afterData: this.auditSnapshot(updated),
          },
          tx,
        );
        return updated;
      }),
    );

    this.logger.log(`Animal updated ${id} by ${actor.userId}`);
    return { animal: this.toView(row), etag: this.etag(row) };
  }

  /**
   * GET /animals — filtered, paginated list. **Authorization-scoped** (rbac-matrix.md:62/81): a
   * USER/capability role sees only animals it owns (owner_id == actor) OR that an organization it
   * org-admins owns; MODERATOR/ADMIN are unrestricted (operator scope). A user-supplied
   * owner_id/organization_id filter is INTERSECTED with that scope (AND), never widens it — so a
   * USER cannot enumerate another principal's animals by passing someone else's owner_id.
   */
  async list(query: AnimalListQueryDto, actor: AuthPrincipal): Promise<Paginated<AnimalView>> {
    const where: Prisma.animalsWhereInput = {};
    if (query.owner_id !== undefined) where.owner_id = query.owner_id;
    if (query.organization_id !== undefined) where.organization_id = query.organization_id;
    if (query.species_id !== undefined) where.species_id = query.species_id;
    if (query.breed_id !== undefined) where.breed_id = query.breed_id;
    if (query.sex !== undefined) where.sex = query.sex;
    if (query.is_active !== undefined) where.is_active = query.is_active;
    if (query.nickname) {
      where.OR = [
        { nickname_localized: { path: ['ru'], string_contains: query.nickname } },
        { nickname_localized: { path: ['en'], string_contains: query.nickname } },
      ];
    }
    const dob: Prisma.DateTimeFilter = {};
    if (query.date_of_birth_min) dob.gte = this.toDate(query.date_of_birth_min);
    if (query.date_of_birth_max) dob.lte = this.toDate(query.date_of_birth_max);
    if (dob.gte || dob.lte) where.date_of_birth = dob;
    const owned: Prisma.DateTimeNullableFilter = {};
    if (query.owned_since_min) owned.gte = this.toDate(query.owned_since_min);
    if (query.owned_since_max) owned.lte = this.toDate(query.owned_since_max);
    if (owned.gte || owned.lte) where.owned_since = owned;

    // Authorization scope (AND-intersected with the query filters above; never widens them).
    const scope = await this.listScope(actor);
    const finalWhere: Prisma.animalsWhereInput = scope ? { AND: [where, scope] } : where;

    const [rows, total] = await Promise.all([
      this.prisma.animals.findMany({
        where: finalWhere,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }) as unknown as Promise<AnimalRow[]>,
      this.prisma.animals.count({ where: finalWhere }),
    ]);
    return paginate(rows.map((r) => this.toView(r)), total, query.page, query.limit);
  }

  /**
   * The ownership-scope clause for a list read (rbac-matrix.md). null = unrestricted (MODERATOR R-any,
   * ADMIN R/any operator scope). Otherwise the actor may see only its own animals plus those owned by
   * an organization it org-admins (parity with create/mutate). Empty org set → owner-only.
   */
  private async listScope(actor: AuthPrincipal): Promise<Prisma.animalsWhereInput | null> {
    if (actor.role === 'MODERATOR' || actor.role === 'ADMIN') return null;
    const orgs = await this.prisma.organization_users.findMany({
      where: { user_id: actor.userId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { organization_id: true },
    });
    const orgIds = orgs.map((o) => o.organization_id);
    const clauses: Prisma.animalsWhereInput[] = [{ owner_id: actor.userId }];
    if (orgIds.length > 0) clauses.push({ organization_id: { in: orgIds } });
    return { OR: clauses };
  }

  /** PATCH /animals/{id}/deactivate — soft delete (is_active=false, deactivated_at=now()). 409 if already off. */
  async deactivate(id: string, actor: AuthPrincipal): Promise<AnimalView> {
    return this.setActive(id, false, actor);
  }

  /** PATCH /animals/{id}/reactivate — inverse. 409 if already active. */
  async reactivate(id: string, actor: AuthPrincipal): Promise<AnimalView> {
    return this.setActive(id, true, actor);
  }

  // ----------------------------------------------------------------------------------------------

  private async setActive(id: string, target: boolean, actor: AuthPrincipal): Promise<AnimalView> {
    const existing = await this.findOrThrow(id);
    await this.assertCanMutate(actor, existing);
    if (existing.is_active === target) {
      throw new ConflictException({
        message: target ? 'Animal is already active' : 'Animal is already deactivated',
        code: 'INVALID_STATE',
      });
    }

    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = (await tx.animals.update({
          where: { id },
          data: { is_active: target, deactivated_at: target ? null : new Date(), updated_at: new Date() },
        })) as unknown as AnimalRow;
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: target ? 'animal.reactivated' : 'animal.deactivated',
            entityType: 'animal',
            entityId: id,
            beforeData: { is_active: existing.is_active },
            afterData: { is_active: target },
          },
          tx,
        );
        return updated;
      }),
    );

    this.logger.log(`Animal ${target ? 'reactivated' : 'deactivated'} ${id} by ${actor.userId}`);
    return this.toView(row);
  }

  private async findOrThrow(id: string): Promise<AnimalRow> {
    const row = (await this.prisma.animals.findUnique({ where: { id } })) as unknown as AnimalRow | null;
    if (!row) throw new NotFoundException({ message: 'Animal not found', code: 'NOT_FOUND' });
    return row;
  }

  /** Object-level mutate check (rbac-matrix.md): owner==actor OR org-admin OR ADMIN operator scope. */
  private async assertCanMutate(actor: AuthPrincipal, row: AnimalRow): Promise<void> {
    const ability = this.abilities.createForPrincipal(actor);
    if (ability.can('update', subject('Animal', this.aclSubject(row)))) return;
    // Org-owned animal: a member who is an org-admin of organization_id may mutate (not expressible in
    // the static CASL map, which keys on owner_id). MODERATOR has no Animal update grant → still denied.
    if (row.organization_id && actor.role !== 'MODERATOR') {
      const isOrgAdmin = await this.isOrgAdmin(actor.userId, row.organization_id);
      if (isOrgAdmin) return;
    }
    throw new ForbiddenException({ message: 'Operation not permitted', code: 'FORBIDDEN' });
  }

  /** A USER creating an org-owned animal must be an org-admin of that organization. */
  private async assertOrgAdmin(actor: AuthPrincipal, organizationId: string): Promise<void> {
    if (actor.role === 'ADMIN') return; // platform-admin operator scope
    if (!(await this.isOrgAdmin(actor.userId, organizationId))) {
      throw new ForbiddenException({
        message: 'You must be an admin of the organization to create an animal it owns',
        code: 'FORBIDDEN',
      });
    }
  }

  private async isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.prisma.organization_users.findFirst({
      where: { user_id: userId, organization_id: organizationId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    return membership !== null;
  }

  private assertOwnershipXor(ownerId?: string, organizationId?: string): void {
    const hasOwner = ownerId != null;
    const hasOrg = organizationId != null;
    if (hasOwner === hasOrg) {
      throw new UnprocessableEntityException({
        message: 'Exactly one of ownerId or organizationId must be set',
        code: 'OWNERSHIP_CONFLICT',
      });
    }
  }

  private assertBreedXor(breedId?: number, breedText?: { en?: string; ru?: string }): void {
    const hasId = breedId != null;
    const hasText = breedText != null && (!!breedText.en?.trim() || !!breedText.ru?.trim());
    if (hasId === hasText) {
      throw new UnprocessableEntityException({
        message: 'Exactly one of breedId or breedTextLocalized must be set',
        code: 'BREED_CONFLICT',
      });
    }
  }

  private assertMicrochipFormat(microchipId?: string | null): void {
    if (microchipId != null && microchipId !== '' && !MICROCHIP_RE.test(microchipId)) {
      throw new UnprocessableEntityException({
        message: 'microchipId must be 15 digits (ISO-11784/85)',
        code: 'VALIDATION_ERROR',
      });
    }
  }

  /** Validate the health_records array (spec line 103). Rejects unknown keys / bad dates. */
  private validateHealthRecords(items?: unknown[]): unknown[] {
    if (items === undefined) return [];
    return this.validateJsonbArray(items, 'healthRecords', HEALTH_KEYS, ['type', 'date']);
  }

  /** Validate the reproductive_data array (spec line 104). */
  private validateReproductiveData(items?: unknown[]): unknown[] {
    if (items === undefined) return [];
    return this.validateJsonbArray(items, 'reproductiveData', REPRO_KEYS, ['event', 'date']);
  }

  private validateJsonbArray(
    items: unknown,
    field: string,
    allowedKeys: Set<string>,
    requiredKeys: string[],
  ): unknown[] {
    if (!Array.isArray(items)) {
      throw new UnprocessableEntityException({ message: `${field} must be an array`, code: 'VALIDATION_ERROR' });
    }
    for (const [i, item] of items.entries()) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new UnprocessableEntityException({
          message: `${field}[${i}] must be an object`,
          code: 'VALIDATION_ERROR',
        });
      }
      const obj = item as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          throw new UnprocessableEntityException({
            message: `${field}[${i}] has unknown key '${key}'`,
            code: 'VALIDATION_ERROR',
          });
        }
      }
      for (const key of requiredKeys) {
        const v = obj[key];
        if (typeof v !== 'string' || v.length === 0) {
          throw new UnprocessableEntityException({
            message: `${field}[${i}].${key} is required`,
            code: 'VALIDATION_ERROR',
          });
        }
      }
      if (typeof obj.date === 'string' && !DATE_RE.test(obj.date)) {
        throw new UnprocessableEntityException({
          message: `${field}[${i}].date must be YYYY-MM-DD`,
          code: 'VALIDATION_ERROR',
        });
      }
    }
    return items;
  }

  /**
   * Run a write, mapping DB-level integrity failures (unique chips/tattoos, the pedigree trigger,
   * the XOR check constraints) to clean RFC7807 4xx — never a 500. The service-layer guards above
   * catch the common cases first; this is the safety net for races and the trigger-only rules.
   */
  private async runWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // 23505 unique_violation → microchip/tattoo already in use.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String((err.meta as { target?: string } | undefined)?.target ?? '');
        const which = target.includes('tattoo') ? 'tattooBrandId' : target.includes('microchip') ? 'microchipId' : 'a unique field';
        throw new ConflictException({ message: `An animal with this ${which} already exists`, code: 'DUPLICATE_IDENTIFIER' });
      }
      // FK violation (Prisma's typed form): a referenced species/breed/owner/parent is missing.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new UnprocessableEntityException({
          message: 'A referenced species/breed/owner/parent does not exist',
          code: 'INVALID_REFERENCE',
        });
      }
      // Raw DB errors surface as PrismaClientUnknownRequestError; the trigger RAISE EXCEPTION carries
      // PG error code P0001, CHECK violations 23514, FK 23503. The whole message (incl. the PG payload)
      // is matched, since Prisma wraps it.
      if (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) {
        const msg = err.message;
        // Immutable-field / MVP ownership-lock trigger (trg_animals_immutable_and_owner, P0001). Checked
        // BEFORE the pedigree branch because both raise P0001 — match on the specific phrasing. The DTO
        // whitelist blocks these fields today; this is the safety net so no future path 500s.
        if (/cannot be changed after creation|Changing ownership is not allowed/i.test(msg)) {
          throw new UnprocessableEntityException({
            message: 'This field cannot be changed after creation',
            code: 'IMMUTABLE_FIELD',
          });
        }
        // Pedigree trigger (P0001): self-parent / wrong-sex / wrong-species / born-before / cycle.
        if (
          /P0001/.test(msg) ||
          /must reference a (Male|Female)|own parent|same species|born before|cycle detected|its own ancestor/i.test(msg)
        ) {
          throw new UnprocessableEntityException({
            message: 'Pedigree integrity violated (parent sex/species/date/cycle)',
            code: 'PEDIGREE_INVALID',
          });
        }
        if (/chk_animal_ownership/i.test(msg)) {
          throw new UnprocessableEntityException({
            message: 'Exactly one of ownerId or organizationId must be set',
            code: 'OWNERSHIP_CONFLICT',
          });
        }
        if (/chk_animals_breed_dep/i.test(msg)) {
          throw new UnprocessableEntityException({
            message: 'Exactly one of breedId or breedTextLocalized must be set',
            code: 'BREED_CONFLICT',
          });
        }
        if (/foreign key|23503/i.test(msg)) {
          throw new UnprocessableEntityException({
            message: 'A referenced species/breed/owner/parent does not exist',
            code: 'INVALID_REFERENCE',
          });
        }
      }
      throw err;
    }
  }

  /** The subject fields CASL ownership conditions key on (owner_id). */
  private aclSubject(row: AnimalRow): { owner_id: string | null; organization_id: string | null } {
    return { owner_id: row.owner_id, organization_id: row.organization_id };
  }

  private etag(row: AnimalRow): string {
    return weakEtag(`animal:${row.id}`, row.updated_at);
  }

  /** Coerce a JSONB locale object into a complete {en, ru} (DB columns are never partial). */
  private normalizeLocalized(value?: { en?: string; ru?: string }): LocalizedString {
    return { en: value?.en ?? '', ru: value?.ru ?? '' };
  }

  /** A YYYY-MM-DD string → a UTC-midnight Date for a @db.Date column (avoids TZ drift). */
  private toDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private auditSnapshot(row: AnimalRow): Record<string, unknown> {
    return {
      ownerId: row.owner_id,
      organizationId: row.organization_id,
      speciesId: row.species_id,
      breedId: row.breed_id,
      nicknameLocalized: row.nickname_localized,
      sex: row.sex,
      isActive: row.is_active,
      microchipId: row.microchip_id,
      tattooBrandId: row.tattoo_brand_id,
    };
  }

  private toView(row: AnimalRow): AnimalView {
    const toDateStr = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
    return {
      id: row.id,
      ownerId: row.owner_id,
      organizationId: row.organization_id,
      speciesId: row.species_id,
      breedId: row.breed_id,
      breedTextLocalized: (row.breed_text_localized as LocalizedString | null) ?? null,
      nicknameLocalized: row.nickname_localized as LocalizedString,
      sex: row.sex as AnimalView['sex'],
      dateOfBirth: toDateStr(row.date_of_birth) as string,
      colorCoat: row.color_coat,
      descriptionLocalized: (row.description_localized as LocalizedString) ?? { en: '', ru: '' },
      microchipId: row.microchip_id,
      tattooBrandId: row.tattoo_brand_id,
      isActive: row.is_active,
      ownedSince: toDateStr(row.owned_since),
      motherId: row.mother_id,
      fatherId: row.father_id,
      healthRecords: (row.health_records as unknown[]) ?? [],
      reproductiveData: (row.reproductive_data as unknown[]) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deactivatedAt: row.deactivated_at,
    };
  }
}
