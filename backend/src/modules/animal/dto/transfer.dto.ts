import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { PrincipalType } from '../../../lib/auth/principal';

/**
 * Ownership-transfer DTOs (transfers-api.yaml, Animal Slice 2 / ADR-0013). camelCase wire bodies
 * (API_CONVENTIONS §0). The recipient is **exactly one of** toUserId / toOrganizationId — the
 * exactly-one-of rule is enforced at the service layer (→ 422 RECIPIENT_AMBIGUOUS / RECIPIENT_REQUIRED)
 * before the DB CHECK, per INV-3.
 */
export class TransferInitiateDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Recipient user (XOR toOrganizationId)' })
  @IsOptional()
  @IsUUID()
  toUserId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Recipient organization (XOR toUserId)' })
  @IsOptional()
  @IsUUID()
  toOrganizationId?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true, description: 'Optional free-text reason' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  transferReason?: string;
}

/** Status filter / sort for GET /transfers. role is required (validated in the controller via enum). */
export const TRANSFER_ROLES = ['initiated', 'incoming'] as const;
export type TransferRole = (typeof TRANSFER_ROLES)[number];
export const TRANSFER_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const;
export type TransferStatusFilter = (typeof TRANSFER_STATUSES)[number];

export class ListTransfersQueryDto {
  // role is functionally required; kept optional here so a MISSING role yields the controller's
  // explicit 400 "role must be one of …" rather than a generic whitelist error, but a PRESENT-but-
  // invalid role is rejected by @IsIn (→ 400, not a silent empty list).
  @ApiPropertyOptional({ enum: TRANSFER_ROLES, description: 'Which side to list for the caller (required)' })
  @IsOptional()
  @IsIn(TRANSFER_ROLES)
  role?: TransferRole;

  @ApiPropertyOptional({ enum: TRANSFER_STATUSES })
  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  status?: TransferStatusFilter;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  animalId?: string;

  @ApiPropertyOptional({ example: 'created_at:desc', description: 'Sort <field>:<asc|desc> (snake_case)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort?: string;

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

/** Acting-principal snapshot (API_CONVENTIONS §15, ADR-0011 §6). */
export interface ActorView {
  actorId: string;
  principalType: PrincipalType;
  actorDisplayName: string | null;
}

/** Wire shape of a Transfer (transfers-api.yaml Transfer). */
export interface TransferView {
  id: string;
  animalId: string;
  fromUserId: string | null;
  fromOrganizationId: string | null;
  toUserId: string | null;
  toOrganizationId: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  terminalReason: 'declined' | 'cancelled_by_initiator' | 'expired' | null;
  transferReason: string | null;
  initiatedBy: ActorView;
  respondedBy: ActorView | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
