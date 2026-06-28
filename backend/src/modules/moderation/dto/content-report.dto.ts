import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { ActorView } from './moderation.dto';

/**
 * Content-report DTOs (moderation-api.yaml `/content-reports`, Slice 4b; invariants CR-1..CR-12).
 * camelCase wire bodies (API_CONVENTIONS §0). `reporterId` is NOT accepted on create — it is derived
 * from the authenticated actor (CR-1, IDOR-class); a body reporterId is an unknown field → 400.
 *
 * MVP entity_types = LISTING | ANIMAL | USER; MESSAGE is forward-compat form, rejected in MVP
 * (ADR-0005, no chat) → 422 ENTITY_TYPE_UNAVAILABLE (CR-3).
 */

export const REPORT_ENTITY_TYPES = ['LISTING', 'ANIMAL', 'USER', 'MESSAGE'] as const;
export type ReportEntityType = (typeof REPORT_ENTITY_TYPES)[number];
/** entity_types a report may target in MVP (MESSAGE excluded — ADR-0005). */
export const MVP_REPORT_ENTITY_TYPES: ReadonlySet<ReportEntityType> = new Set(['LISTING', 'ANIMAL', 'USER']);

export const REPORT_REASONS = ['SPAM', 'ABUSE', 'FRAUD', 'INAPPROPRIATE', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
/** Terminal statuses (CR-8). */
export const TERMINAL_REPORT_STATUSES: ReadonlySet<ReportStatus> = new Set(['DISMISSED', 'ACTIONED']);
/** Statuses a resolve may move TO. */
export const RESOLVABLE_TARGETS = ['REVIEWED', 'DISMISSED', 'ACTIONED'] as const;
export type ResolveTarget = (typeof RESOLVABLE_TARGETS)[number];

/** Legal transitions (CR-7): OPEN→{REVIEWED,DISMISSED,ACTIONED}; REVIEWED→{DISMISSED,ACTIONED}. */
export const REPORT_TRANSITIONS: Record<ReportStatus, ReadonlySet<ResolveTarget>> = {
  OPEN: new Set(['REVIEWED', 'DISMISSED', 'ACTIONED']),
  REVIEWED: new Set(['DISMISSED', 'ACTIONED']),
  DISMISSED: new Set(),
  ACTIONED: new Set(),
};

export class ContentReportCreateDto {
  @ApiProperty({ enum: REPORT_ENTITY_TYPES })
  @IsIn(REPORT_ENTITY_TYPES)
  entityType!: ReportEntityType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entityId!: string;

  @ApiProperty({ enum: REPORT_REASONS, description: 'CR-11: reason ∈ enum (DB column stays VARCHAR)' })
  @IsIn(REPORT_REASONS)
  reason!: ReportReason;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ResolveContentReportDto {
  @ApiProperty({ enum: RESOLVABLE_TARGETS, description: 'CR-7 transition target' })
  @IsIn(RESOLVABLE_TARGETS)
  status!: ResolveTarget;
}

export class ListContentReportsQueryDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: REPORT_ENTITY_TYPES })
  @IsOptional()
  @IsIn(REPORT_ENTITY_TYPES)
  entity_type?: ReportEntityType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entity_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Operator-only filter (ignored / self for a USER)' })
  @IsOptional()
  @IsUUID()
  reporter_id?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** Wire shape of a ContentReport (moderation-api.yaml ContentReport). resolvedBy is an Actor badge. */
export interface ContentReportView {
  id: string;
  reporterId: string | null;
  entityType: ReportEntityType;
  entityId: string;
  reason: string;
  notes: string | null;
  status: ReportStatus;
  resolvedBy: ActorView | null;
  createdAt: Date;
  updatedAt: Date;
}
