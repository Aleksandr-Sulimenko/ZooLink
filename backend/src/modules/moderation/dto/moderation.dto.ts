import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { PrincipalType } from '../../../lib/auth/principal';

/**
 * Moderation Domain DTOs (moderation-api.yaml, Admin Slice 4a; ADR-0003 pre-moderation, ADR-0006/0011
 * agent-as-principal). camelCase wire bodies (API_CONVENTIONS §0).
 *
 * Naming (deliberate verb-vs-state split — do NOT collapse): the REQUEST field is `action`
 * (APPROVE|REJECT|REQUEST_CHANGES); the ledger/response `decision` is APPROVED|REJECTED|
 * CHANGES_REQUESTED. The service maps action→decision + the listing transition.
 */

export const MODERATION_ACTIONS = ['APPROVE', 'REJECT', 'REQUEST_CHANGES'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const MODERATION_DECISIONS = ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export type ModerationDecisionValue = (typeof MODERATION_DECISIONS)[number];

export const SLA_STATES = ['ON_TRACK', 'BREACHED', 'ESCALATED'] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const LOCK_STATES = ['FREE', 'CLAIMED_BY_ME', 'CLAIMED_BY_OTHER', 'LOCK_EXPIRED'] as const;
export type LockState = (typeof LOCK_STATES)[number];

export const MARKETS = ['pet', 'livestock'] as const;
export type Market = (typeof MARKETS)[number];

/** action→decision map (verb→state). */
export const ACTION_TO_DECISION: Record<ModerationAction, ModerationDecisionValue> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

function toBool({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** GET /moderation/queue filters. */
export class ModerationQueueQueryDto {
  @ApiPropertyOptional({ enum: MARKETS })
  @IsOptional()
  @IsIn(MARKETS)
  market?: Market;

  @ApiPropertyOptional({ enum: SLA_STATES })
  @IsOptional()
  @IsIn(SLA_STATES)
  slaState?: SlaState;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  escalated?: boolean;

  @ApiPropertyOptional({ enum: LOCK_STATES })
  @IsOptional()
  @IsIn(LOCK_STATES)
  lockState?: LockState;

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

/** POST /moderation/action body (verb `action`; server maps to the `decision` state). */
export class ModerationActionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId!: string;

  @ApiProperty({ enum: MODERATION_ACTIONS })
  @IsIn(MODERATION_ACTIONS)
  action!: ModerationAction;

  @ApiPropertyOptional({ description: 'moderation_reasons.code (mandatory for REJECT/REQUEST_CHANGES — M-9)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reason?: string;

  @ApiPropertyOptional({ nullable: true, description: 'decision_templates.code (optional canned note — M-10)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateCode?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Free-text note (supplements/overrides the template)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Human-override: decision to supersede (M-7)' })
  @IsOptional()
  @IsUUID()
  supersedesDecisionId?: string;
}

/** GET /moderation/decisions filters. */
export class ListDecisionsQueryDto {
  @ApiPropertyOptional({ enum: ['LISTING', 'ANIMAL'] })
  @IsOptional()
  @IsIn(['LISTING', 'ANIMAL'])
  entity_type?: 'LISTING' | 'ANIMAL';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entity_id?: string;

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

/** GET /moderation/decision-templates filters. */
export class ListTemplatesQueryDto {
  @ApiPropertyOptional({ enum: ['REJECTED', 'CHANGES_REQUESTED', 'ANY'] })
  @IsOptional()
  @IsIn(['REJECTED', 'CHANGES_REQUESTED', 'ANY'])
  appliesToDecision?: 'REJECTED' | 'CHANGES_REQUESTED' | 'ANY';

  @ApiPropertyOptional({ enum: MARKETS })
  @IsOptional()
  @IsIn(MARKETS)
  market?: Market;
}

// ── wire shapes ──────────────────────────────────────────────────────────────────────────────

export interface LocalizedString {
  en: string;
  ru: string;
}

/** Actor agent-badge (ADR-0011 §6). */
export interface ActorView {
  actorId: string;
  principalType: PrincipalType;
  actorDisplayName: string | null;
}

export interface ModerationQueueItemView {
  listingId: string;
  titleLocalized: LocalizedString;
  market: Market;
  species: string | null;
  submittedAt: Date;
  waitingSeconds: number;
  slaState: SlaState;
  lockState: LockState;
  assignedTo: ActorView | null;
  lockedAt: Date | null;
  lockExpiresAt: Date | null;
}

export interface QueueGroupCounts {
  byMarket: { pet: number; livestock: number };
  bySlaState: { ON_TRACK: number; BREACHED: number; ESCALATED: number };
}

export interface ModerationLockView {
  listingId: string;
  assignedTo: ActorView;
  lockedAt: Date;
  lockExpiresAt: Date;
  lockState: 'CLAIMED_BY_ME';
}

export interface ModerationDecisionView {
  id: string;
  actor: ActorView;
  actorRole: string | null;
  entityType: 'LISTING' | 'ANIMAL';
  entityId: string;
  decision: ModerationDecisionValue;
  reason: string | null;
  notes: string | null;
  supersedesDecisionId: string | null;
  isHumanOverride: boolean;
  createdAt: Date;
}

export interface OwnerModerationResultView {
  listingId: string;
  decision: ModerationDecisionValue;
  reason: LocalizedString | null;
  notes: string | null;
  decidedBy: ActorView;
  decidedByAgent: boolean;
  isHumanOverride: boolean;
  supersedesDecisionId: string | null;
  decidedAt: Date;
}

export interface ModerationReasonView {
  code: string;
  descriptionLocalized: LocalizedString;
  appliesTo: 'LISTING' | 'ANIMAL' | 'ANY';
  isActive: boolean;
}

export interface DecisionTemplateView {
  code: string;
  bodyLocalized: LocalizedString;
  appliesToDecision: 'REJECTED' | 'CHANGES_REQUESTED' | 'ANY';
  market: Market | null;
  relatedReasonCode: string | null;
  sortOrder: number;
  isActive: boolean;
}
