import { Body, Controller, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../lib/auth/public.decorator';
import { IdentityService, type AuthResponse } from './identity.service';
import { RecoveryService } from './recovery.service';
import {
  OAuthDto,
  RecoverEmailRequestDto,
  RecoverEmailVerifyDto,
  RegisterPhoneDto,
  RegisterPhoneResponseDto,
  VerifyPhoneDto,
} from './dto/identity.dto';

// Per-IP SMS abuse caps (spec 01 / BR 5.6: ~5 / 15 min per IP), tighter than the global 100/60s.
// The OtpService adds per-PHONE cooldown (60s) + 5-attempt → 15-min lockout; these are the per-IP layer.
const REGISTER_THROTTLE = { default: { limit: 5, ttl: 900_000 } };
const VERIFY_THROTTLE = { default: { limit: 15, ttl: 900_000 } };
const OAUTH_THROTTLE = { default: { limit: 20, ttl: 900_000 } };
// Recovery sends email OTP — same per-IP shape as phone register/verify (spec 01 Slice-4).
const RECOVER_REQUEST_THROTTLE = { default: { limit: 5, ttl: 900_000 } };
const RECOVER_VERIFY_THROTTLE = { default: { limit: 15, ttl: 900_000 } };

/**
 * Identity endpoints (Phase 2) under /v1/auth. Passwordless phone flow (spec 01 round-4):
 * register → OTP, then verify → session. Both are @Public (no token yet).
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly recovery: RecoveryService,
  ) {}

  @Public()
  @Throttle(REGISTER_THROTTLE)
  @Post('register/phone')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Register via phone — sends an SMS OTP (passwordless)' })
  registerPhone(@Body() dto: RegisterPhoneDto): Promise<RegisterPhoneResponseDto> {
    return this.identity.registerPhone(dto);
  }

  @Public()
  @Throttle(VERIFY_THROTTLE)
  @Post('verify-phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the SMS OTP — activates the account and issues a session' })
  verifyPhone(@Body() dto: VerifyPhoneDto): Promise<AuthResponse> {
    return this.identity.verifyPhone(dto);
  }

  @Public()
  @Throttle(OAUTH_THROTTLE)
  @Post('register/oauth/:provider')
  @ApiOperation({ summary: 'Login or register via an OAuth provider — issues a session' })
  async oauth(
    @Param('provider') provider: string,
    @Body() dto: OAuthDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { response, isNew } = await this.identity.oauthLogin(provider, dto);
    res.status(isNew ? HttpStatus.CREATED : HttpStatus.OK);
    return response;
  }

  @Public()
  @Throttle(RECOVER_REQUEST_THROTTLE)
  @Post('recover/email/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request account recovery via a verified email — sends an OTP (always 202)' })
  recoverEmailRequest(@Body() dto: RecoverEmailRequestDto): Promise<RegisterPhoneResponseDto> {
    return this.recovery.requestEmail(dto);
  }

  @Public()
  @Throttle(RECOVER_VERIFY_THROTTLE)
  @Post('recover/email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the email recovery OTP — issues a session' })
  recoverEmailVerify(@Body() dto: RecoverEmailVerifyDto): Promise<AuthResponse> {
    return this.recovery.verifyEmail(dto);
  }
}
