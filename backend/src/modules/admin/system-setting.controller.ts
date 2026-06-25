import { Body, Controller, Get, Headers, Ip, Param, Patch, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { SystemSettingService } from './system-setting.service';
import { UpdateSystemSettingDto, type SystemSetting } from './dto/system-setting.dto';

/**
 * System Settings (admin-api.yaml getSystemSettings / updateSystemSetting, Admin Slice 3) under
 * /v1/system/settings. ADMIN-only (@Roles('ADMIN') + global JwtAuthGuard/RolesGuard → 401 unauth /
 * 403 wrong role). Backed by `feature_toggles` (data-governance.md §6); the mutation reuses
 * FeatureToggleService.flip (atomic upsert + audit_log) and adds If-Match/ETag optimistic concurrency.
 *
 * GET returns the contract's object MAP (additionalProperties: SystemSetting), not a {items, meta}
 * page — see the flagged envelope conflict.
 */
@ApiTags('admin-system-settings')
@Roles('ADMIN')
@Controller({ path: 'system/settings', version: '1' })
export class SystemSettingController {
  constructor(private readonly service: SystemSettingService) {}

  @Get()
  @ApiOperation({ summary: '[ADMIN] Get all system settings (object map keyed by setting key)' })
  getAll(): Promise<Record<string, SystemSetting>> {
    return this.service.getAll();
  }

  @Patch(':key')
  @ApiOperation({ summary: '[ADMIN] Update a system setting (requires If-Match; 412/428 on concurrency)' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSystemSettingDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SystemSetting> {
    const { setting, etag } = await this.service.update(key, dto, ifMatch, actor, {
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
    });
    res.setHeader('ETag', etag);
    return setting;
  }
}
