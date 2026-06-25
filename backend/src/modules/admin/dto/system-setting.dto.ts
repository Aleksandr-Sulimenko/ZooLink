import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { ActorBadge } from './audit-log.dto';

/**
 * Update body for PATCH /system/settings/{key} (admin-api.yaml SystemSettingUpdateRequest).
 * `value` is a string; for an MVP feature-toggle setting it is a JSON string encoding the toggle
 * state `{"isEnabled": boolean, "rolloutPercentage": int}` (see SystemSettingService for the contract
 * gap note — settings are backed by `feature_toggles` in the MVP).
 */
export class UpdateSystemSettingDto {
  @ApiProperty({ description: 'New setting value (JSON string for complex values, e.g. toggle state)' })
  @IsString()
  @MaxLength(2000)
  value!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, description: 'Updated setting description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/**
 * Wire shape of a system setting (admin-api.yaml SystemSetting). `updatedBy` is the
 * {actorId, principalType} Actor badge (ADR-0011 §6), nullable when never updated.
 */
export interface SystemSetting {
  key: string;
  /** JSON string of the setting value. For a feature-toggle: `{"isEnabled":bool,"rolloutPercentage":int}`. */
  value: string;
  description: string | null;
  updatedAt: Date;
  updatedBy: ActorBadge | null;
}
