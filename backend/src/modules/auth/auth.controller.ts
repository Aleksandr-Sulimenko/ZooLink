import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../lib/auth/public.decorator';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import { CheckPolicies } from '../../lib/auth/policies.guard';
import type { AuthPrincipal, PrincipalType, Role } from '../../lib/auth/principal';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuthService } from './auth.service';
import { parseDurationMs } from './refresh-token.service';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';
import { AccessTokenDto, DevTokenDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.refreshTtlMs = parseDurationMs(this.config.get('JWT_REFRESH_TTL'));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh cookie and obtain a new access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenDto> {
    // Refresh token is read from the HttpOnly cookie, never the body (XSS-exfil defence, AUDIT3 #2).
    const presented = readRefreshCookie(req);
    if (!presented) {
      throw new UnauthorizedException({
        message: 'Missing refresh token',
        code: 'UNAUTHENTICATED',
      });
    }
    const pair = await this.auth.refresh(presented);
    setRefreshCookie(res, pair.refreshToken, this.refreshTtlMs);
    return { accessToken: pair.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session (or all sessions if no cookie present)' })
  async logout(
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Targeted single-device logout when the refresh cookie is present; revoke-all otherwise.
    await this.auth.logout(user.userId, readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  @Get('whoami')
  @ApiOperation({ summary: 'Return the authenticated principal (verifies the guard end-to-end)' })
  whoami(@CurrentUser() user: AuthPrincipal): AuthPrincipal {
    return user;
  }

  @Get('operator-check')
  @Roles('MODERATOR')
  @CheckPolicies((ability) => ability.can('read', 'ModerationQueue'))
  @ApiOperation({ summary: '[test] Requires an operator role + policy (verifies AuthZ end-to-end)' })
  operatorCheck(@CurrentUser() user: AuthPrincipal): { ok: true; role: AuthPrincipal['role'] } {
    return { ok: true, role: user.role };
  }

  /**
   * DEV-ONLY session minting. Until the Identity domain (Phase 2) provides real login/OTP/OAuth,
   * this lets us exercise auth end-to-end against a seeded user. Disabled in production.
   */
  @Public()
  @Post('dev-token')
  @ApiOperation({ summary: '[dev only] Mint a session for an existing user id' })
  async devToken(
    @Body() dto: DevTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenDto> {
    // FAIL-CLOSED: reachable ONLY when ENABLE_DEV_TOKEN===true AND NODE_ENV!=='production'
    // (AppConfigService.isDevTokenEnabled). A prod deploy — or any deploy that forgets to opt in —
    // gets a 404, closing the arbitrary-account-takeover chain (AUDIT3 security.md #1).
    if (!this.config.isDevTokenEnabled) {
      throw new NotFoundException({ message: 'Not found', code: 'NOT_FOUND' });
    }
    const user = await this.prisma.users.findUnique({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException({ message: 'User not found', code: 'NOT_FOUND' });
    }
    const principal: AuthPrincipal = {
      userId: user.id,
      role: user.role as Role,
      principalType: user.principal_type as PrincipalType,
    };
    const pair = await this.auth.issueSession(principal, 'dev-token');
    setRefreshCookie(res, pair.refreshToken, this.refreshTtlMs);
    return { accessToken: pair.accessToken };
  }
}
