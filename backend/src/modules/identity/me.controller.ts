import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { matchesIfNoneMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/identity.dto';
import type { UserProfile } from './user-profile.util';

/**
 * Self-service profile under /v1/me (authenticated — global JwtAuthGuard, no @Public).
 * GET returns a weak ETag; PATCH requires If-Match (optimistic concurrency, API_CONVENTIONS §10).
 */
@ApiTags('identity')
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile (+ETag; supports If-None-Match → 304)' })
  async getMe(
    @CurrentUser() user: AuthPrincipal,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserProfile | undefined> {
    const { profile, etag } = await this.profile.getMe(user.userId);
    res.setHeader('ETag', etag);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return profile;
  }

  @Patch()
  @ApiOperation({ summary: 'Update current user profile (requires If-Match)' })
  async updateMe(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: UpdateProfileDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserProfile> {
    const { profile, etag } = await this.profile.updateMe(user.userId, dto, ifMatch);
    res.setHeader('ETag', etag);
    return profile;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate current account (recoverable 30 days)' })
  deactivate(@CurrentUser() user: AuthPrincipal): Promise<void> {
    return this.profile.deactivateMe(user.userId);
  }

  @Post('reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a deactivated account (within grace)' })
  reactivate(@CurrentUser() user: AuthPrincipal): Promise<UserProfile> {
    return this.profile.reactivateMe(user.userId);
  }

  @Post('erase')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request erasure of the current account (ФЗ-152) — deactivates now, anonymises after grace' })
  erase(@CurrentUser() user: AuthPrincipal): Promise<void> {
    return this.profile.eraseMe(user.userId);
  }
}
