import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../lib/auth/public.decorator';
import { IdentityService, type AuthResponse } from './identity.service';
import { RegisterPhoneDto, RegisterPhoneResponseDto, VerifyPhoneDto } from './dto/identity.dto';

/**
 * Identity endpoints (Phase 2) under /v1/auth. Passwordless phone flow (spec 01 round-4):
 * register → OTP, then verify → session. Both are @Public (no token yet).
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('register/phone')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Register via phone — sends an SMS OTP (passwordless)' })
  registerPhone(@Body() dto: RegisterPhoneDto): Promise<RegisterPhoneResponseDto> {
    return this.identity.registerPhone(dto);
  }

  @Public()
  @Post('verify-phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the SMS OTP — activates the account and issues a session' })
  verifyPhone(@Body() dto: VerifyPhoneDto): Promise<AuthResponse> {
    return this.identity.verifyPhone(dto);
  }
}
