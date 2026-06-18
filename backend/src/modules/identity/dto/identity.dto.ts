import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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

export class RegisterPhoneResponseDto {
  @ApiProperty({ enum: ['VERIFICATION_REQUIRED'] })
  status!: 'VERIFICATION_REQUIRED';

  @ApiProperty({ description: 'OTP validity window in seconds' })
  expiresInSeconds!: number;
}
