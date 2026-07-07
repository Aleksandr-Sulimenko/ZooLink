import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Role } from '../../../lib/auth/principal';

const ROLES = ['USER', 'MODERATOR', 'ADMIN', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER'] as const;
const OAUTH_PROVIDERS = ['google', 'apple', 'telegram', 'vk'] as const;

const E164 = /^\+?[1-9]\d{7,14}$/;

/**
 * Avatar URL validation (AUDIT3 security.md #2 / frontend-engineer): a stored `javascript:`/`data:`
 * URL renders as stored-XSS in any operator/admin/SPA surface that shows the avatar (ADR-0006 makes
 * operators agents/humans — a poisoned avatar is a cross-tenant seam). `@IsUrl` with an https-only
 * protocol allowlist + require_protocol rejects `javascript:alert(1)`, `data:text/html,…`, protocol-
 * relative and http URLs (400 VALIDATION_ERROR). Enforces the `format: uri` the contract declares
 * (OpenAPI `format` is documentation-only — class-validator is the runtime gate).
 */
export const AVATAR_URL_OPTS = { protocols: ['https'], require_protocol: true };

export class RegisterPhoneDto {
  @ApiProperty({ description: 'Phone number in E.164 format', example: '+79991234567' })
  @IsString()
  @Matches(E164, { message: 'phone must be a valid E.164 number' })
  phone!: string;

  @ApiProperty({ description: 'Display name', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @ApiPropertyOptional({ description: 'City id (cities.id) for geo-search' })
  @IsOptional()
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional({ description: 'Email for notifications' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Avatar URL in object storage (https only)', format: 'uri' })
  @IsOptional()
  @IsUrl(AVATAR_URL_OPTS)
  @MaxLength(500)
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Preferred language', enum: ['ru', 'en'] })
  @IsOptional()
  @IsIn(['ru', 'en'])
  preferredLanguage?: 'ru' | 'en';
}

export class VerifyPhoneDto {
  @ApiProperty({ description: 'Phone number in E.164 format', example: '+79991234567' })
  @IsString()
  @Matches(E164, { message: 'phone must be a valid E.164 number' })
  phone!: string;

  @ApiProperty({ description: '6-digit SMS verification code', example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class OAuthDto {
  @ApiProperty({ description: 'Authorization code / id_token / signed login payload from the provider' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ description: 'Display name (provider data takes precedence)', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @ApiPropertyOptional({ description: 'City id (cities.id) for geo-search' })
  @IsOptional()
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional({ description: 'Email (provider data takes precedence)' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Avatar URL (https only)', format: 'uri' })
  @IsOptional()
  @IsUrl(AVATAR_URL_OPTS)
  @MaxLength(500)
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Preferred language', enum: ['ru', 'en'] })
  @IsOptional()
  @IsIn(['ru', 'en'])
  preferredLanguage?: 'ru' | 'en';
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ description: 'City id (cities.id); null clears it', nullable: true })
  @IsOptional()
  @IsInt()
  cityId?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  @IsOptional()
  @IsUrl(AVATAR_URL_OPTS)
  @MaxLength(500)
  avatarUrl?: string | null;

  @ApiPropertyOptional({ enum: ['ru', 'en'] })
  @IsOptional()
  @IsIn(['ru', 'en'])
  preferredLanguage?: 'ru' | 'en';

  // ── Contact-exchange channels (ADR-0020 / ADR-0005). Setting a channel + turning it on is the opt-in
  //    that records a CONTACT_DISTRIBUTION consent (see ProfileService.updateMe). `null` clears a channel. ──
  @ApiPropertyOptional({
    description: 'Marketplace contact phone (E.164). Stored AES-256-GCM at rest (ADR-0019). null clears it.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(E164, { message: 'contactPhone must be a valid E.164 number' })
  contactPhone?: string | null;

  @ApiPropertyOptional({
    description: 'Marketplace contact Telegram handle (5–32 chars, optional leading @). null clears it.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^@?[A-Za-z0-9_]{5,32}$/, { message: 'contactTelegram must be a valid Telegram handle' })
  @MaxLength(64)
  contactTelegram?: string | null;

  @ApiPropertyOptional({
    description: 'Show the phone to buyers on contact-reveal. Turning any channel on records CONTACT_DISTRIBUTION consent (ADR-0020).',
  })
  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  @ApiPropertyOptional({
    description: 'Show the Telegram handle to buyers on contact-reveal. Turning any channel on records CONTACT_DISTRIBUTION consent (ADR-0020).',
  })
  @IsOptional()
  @IsBoolean()
  showTelegram?: boolean;
}

export class RegisterPhoneResponseDto {
  @ApiProperty({ enum: ['VERIFICATION_REQUIRED'] })
  status!: 'VERIFICATION_REQUIRED';

  @ApiProperty({ description: 'OTP validity window in seconds' })
  expiresInSeconds!: number;
}

export class RecoverEmailRequestDto {
  @ApiProperty({ description: 'Verified email on file for the account to recover' })
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class RecoverEmailVerifyDto {
  @ApiProperty({ description: 'Verified email the recovery OTP was sent to' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ description: '6-digit recovery code', example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class SetRoleDto {
  @ApiProperty({ description: 'New role to grant', enum: ROLES })
  @IsIn(ROLES)
  role!: Role;
}

export class RebindDto {
  @ApiPropertyOptional({ description: 'New phone (E.164) to bind' })
  @IsOptional()
  @IsString()
  @Matches(E164, { message: 'newPhone must be a valid E.164 number' })
  newPhone?: string;

  @ApiPropertyOptional({ description: 'OAuth provider to (re)bind or clear', enum: OAUTH_PROVIDERS })
  @IsOptional()
  @IsIn(OAUTH_PROVIDERS)
  oauthProvider?: (typeof OAUTH_PROVIDERS)[number];

  @ApiPropertyOptional({ description: 'New provider-side id to bind (omit with clear=true)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  oauthId?: string;

  @ApiPropertyOptional({ description: 'When true with oauthProvider, unbinds that OAuth identifier' })
  @IsOptional()
  @IsBoolean()
  clear?: boolean;

  @ApiPropertyOptional({ description: 'Operator-supplied reason (recorded in audit_log)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
