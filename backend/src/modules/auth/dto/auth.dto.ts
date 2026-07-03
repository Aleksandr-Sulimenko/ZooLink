import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** DEV-ONLY: mint a session for an existing user id (no login machinery yet — Identity is Phase 2). */
export class DevTokenDto {
  @ApiProperty({ description: 'Existing users.id to mint a session for (non-production only)' })
  @IsUUID()
  userId!: string;
}

/**
 * Session response body. Only the SHORT-LIVED access token is returned in the body; the long-lived
 * refresh token is delivered as an HttpOnly+Secure+SameSite=Strict cookie (`refresh_token`) and is
 * NEVER in the body (API_CONVENTIONS §2 / AUDIT3 security.md #2 — XSS-exfil defence).
 */
export class AccessTokenDto {
  @ApiProperty({ description: 'JWT access token (expires in 15 min). Refresh token is a cookie.' })
  accessToken!: string;
}
