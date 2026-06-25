import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Contract `entityType` enum (admin-api.yaml AuditLogEntry / getAuditLog). The bare logical entity
 * names. Reference-data writes store the suffixed form `reference-data:{dataset}` in
 * `audit_log.entity_type`; the read layer normalises that to the bare `reference-data` and carries the
 * dataset separately in `referenceDataset`. `feature-toggle` is stored as `feature_toggle` (underscore)
 * by FeatureToggleService and normalised to the contract hyphen form on read.
 */
export const AUDIT_ENTITY_TYPES = [
  'listing',
  'user',
  'organization',
  'reference-data',
  'moderation-action',
  'feature-toggle',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Reference datasets (admin-api.yaml referenceDataset enum; mirrors the managed lookup registry). */
export const REFERENCE_DATASETS = [
  'species',
  'breeds',
  'cities',
  'health_certifications',
  'genetic_markers',
] as const;
export type ReferenceDataset = (typeof REFERENCE_DATASETS)[number];

/**
 * Audit verb shape (admin-api.yaml actionType): namespaced `{domain}.{verb}` (lower_snake segments,
 * dot-separated) — an OPEN string mirroring the free-text `audit_log.action VARCHAR(100)` column, not a
 * closed enum. The filter is an exact-equality match on the stored verb (no lossy enum collapse).
 */
const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/**
 * Query for GET /audit/log (admin-api.yaml getAuditLog, ADMIN-only). `entityId` (UUID) and
 * `entityIdInt` (integer) are mutually exclusive — supplying both → 400 VALIDATION_ERROR
 * (enforced in the service, mirrors database_schema.sql "exactly one populated per row"). Dates are
 * inclusive ISO calendar dates (YYYY-MM-DD).
 */
export class ListAuditLogQueryDto {
  @ApiPropertyOptional({ enum: AUDIT_ENTITY_TYPES, description: 'Filter by bare entity type' })
  @IsOptional()
  @IsIn(AUDIT_ENTITY_TYPES)
  entityType?: AuditEntityType;

  @ApiPropertyOptional({
    enum: REFERENCE_DATASETS,
    description: 'Narrow reference-data rows to a single dataset (entity_type = reference-data:{dataset}); only meaningful with entityType=reference-data.',
  })
  @IsOptional()
  @IsIn(REFERENCE_DATASETS)
  referenceDataset?: ReferenceDataset;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by UUID entity id (audit_log.entity_id). Mutually exclusive with entityIdInt.' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ minimum: 1, description: 'Filter by INT entity id (audit_log.entity_id_int; reference-data). Mutually exclusive with entityId.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  entityIdInt?: number;

  @ApiPropertyOptional({
    description: 'Filter by the exact stored audit verb ({domain}.{verb}, e.g. identity.role_changed).',
    pattern: AUDIT_ACTION_PATTERN.source,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(AUDIT_ACTION_PATTERN, { message: 'actionType must be a {domain}.{verb} dotted lower_snake verb' })
  actionType?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by acting principal (users.id)' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Start date (inclusive, YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startDate?: string;

  @ApiPropertyOptional({ format: 'date', description: 'End date (inclusive, YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  endDate?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 100;

  @ApiPropertyOptional({ description: 'Filter by sort (created_at:asc|desc)', default: 'created_at:desc' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sort: string = 'created_at:desc';
}

/** Actor-badge (admin-api.yaml Actor / ADR-0011 §6): {actorId, principalType} + optional display name. */
export interface ActorBadge {
  actorId: string | null;
  principalType: 'HUMAN' | 'AGENT';
  actorDisplayName: string | null;
}

/** Wire shape of one audit-log entry (admin-api.yaml AuditLogEntry). */
export interface AuditLogEntry {
  id: string;
  entityType: string;
  /** Reference dataset (when entityType=reference-data, parsed from the stored suffix); null otherwise. */
  referenceDataset: string | null;
  /** UUID id for UUID-keyed entities; null when the row is INT-keyed (see entityIdInt). */
  entityId: string | null;
  /** INT id for INT-keyed lookup entities (reference-data); null when UUID-keyed. */
  entityIdInt: number | null;
  /** The exact stored audit verb (`audit_log.action`), returned verbatim ({domain}.{verb}). */
  actionType: string;
  actor: ActorBadge;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}
