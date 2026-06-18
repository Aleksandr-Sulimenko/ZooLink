import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh token from a prior session' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Refresh token to revoke (single device). If omitted, all sessions are revoked.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

/** DEV-ONLY: mint a session for an existing user id (no login machinery yet — Identity is Phase 2). */
export class DevTokenDto {
  @ApiProperty({ description: 'Existing users.id to mint a session for (non-production only)' })
  @IsUUID()
  userId!: string;
}

export class TokenPairDto {
  @ApiProperty({ description: 'JWT access token (expires in 15 min)' })
  accessToken!: string;

  @ApiProperty({ description: 'Opaque refresh token (expires in 7 days; rotated on use)' })
  refreshToken!: string;
}
