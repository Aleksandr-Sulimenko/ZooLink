import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../lib/auth/public.decorator';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import type { AuthPrincipal, PrincipalType, Role } from '../../lib/auth/principal';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuthService, type TokenPair } from './auth.service';
import { DevTokenDto, LogoutDto, RefreshTokenDto, TokenPairDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate a refresh token and obtain a new access token' })
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenPair> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session (or all sessions if no token given)' })
  async logout(@CurrentUser() user: AuthPrincipal, @Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(user.userId, dto.refreshToken);
  }

  @Get('whoami')
  @ApiOperation({ summary: 'Return the authenticated principal (verifies the guard end-to-end)' })
  whoami(@CurrentUser() user: AuthPrincipal): AuthPrincipal {
    return user;
  }

  /**
   * DEV-ONLY session minting. Until the Identity domain (Phase 2) provides real login/OTP/OAuth,
   * this lets us exercise auth end-to-end against a seeded user. Disabled in production.
   */
  @Public()
  @Post('dev-token')
  @ApiOperation({ summary: '[dev only] Mint a session for an existing user id' })
  async devToken(@Body() dto: DevTokenDto): Promise<TokenPairDto> {
    if (this.config.isProduction) {
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
    return this.auth.issueSession(principal, 'dev-token');
  }
}
