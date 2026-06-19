import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { AdminUserService } from './admin-user.service';
import { RebindDto, SetRoleDto } from './dto/identity.dto';
import type { UserProfile } from './user-profile.util';

/**
 * ADMIN-only identity operations (spec 01 Slice-4) under /v1/admin/users/:userId.
 * Authenticated (global JwtAuthGuard) + @Roles('ADMIN') (rbac-matrix.md: User roles/status = ADMIN).
 * Each action is audit-logged with the ADMIN as actor and revokes the target's sessions.
 */
@ApiTags('identity-admin')
@Roles('ADMIN')
@Controller({ path: 'admin/users', version: '1' })
export class AdminUserController {
  constructor(private readonly admin: AdminUserService) {}

  @Patch(':userId/role')
  @ApiOperation({ summary: '[ADMIN] Grant/change a user role (revokes target sessions)' })
  setRole(
    @CurrentUser() actor: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetRoleDto,
  ): Promise<UserProfile> {
    return this.admin.setRole(actor, userId, dto);
  }

  @Post(':userId/rebind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[ADMIN] Re-bind a phone/OAuth identifier (assisted recovery)' })
  rebind(
    @CurrentUser() actor: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RebindDto,
  ): Promise<UserProfile> {
    return this.admin.rebind(actor, userId, dto);
  }

  @Post(':userId/erase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[ADMIN] Erase (anonymise) a user — ФЗ-152 right-to-erasure (idempotent)' })
  erase(
    @CurrentUser() actor: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.admin.erase(actor, userId);
  }
}
