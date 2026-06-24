import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Role } from '../../../lib/auth/principal';

const ROLES = ['USER', 'MODERATOR', 'ADMIN', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER'] as const;
const OAUTH_PROVIDERS = ['google', 'apple', 'telegram', 'vk'] as const;

const E164 = /^\+?[1-9]\d{7,14}$/;

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

  @ApiPropertyOptional({ description: 'Avatar URL in object storage' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ description: 'Avatar URL' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null;

  @ApiPropertyOptional({ enum: ['ru', 'en'] })
  @IsOptional()
  @IsIn(['ru', 'en'])
  preferredLanguage?: 'ru' | 'en';
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
