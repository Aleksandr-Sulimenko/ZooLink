import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../lib/auth/roles.decorator';
import type { Paginated } from '../../lib/pagination/page';
import { AdminUserService } from '../identity/admin-user.service';
import { ListUsersWithRolesQueryDto, type UserRoleInfo } from './dto/user-roles.dto';

/**
 * Admin Users & Roles list (admin-api.yaml getUsersWithRoles, Admin Slice 2) under /v1/users/roles.
 * ADMIN-only (@Roles('ADMIN') + global JwtAuthGuard/RolesGuard → 401 unauth / 403 wrong role).
 * Read-only; reuses AdminUserService (identity module) for the user read — no duplicate user access.
 * Role CHANGE is owned by auth-api PATCH /admin/users/{userId}/role (AdminUserService.setRole) — not here.
 */
@ApiTags('admin-users-roles')
@Roles('ADMIN')
@Controller({ path: 'users/roles', version: '1' })
export class UserRolesController {
  constructor(private readonly admin: AdminUserService) {}

  @Get()
  @ApiOperation({ summary: '[ADMIN] List users with their roles (filter by role/isActive/search)' })
  list(@Query() query: ListUsersWithRolesQueryDto): Promise<Paginated<UserRoleInfo>> {
    return this.admin.listWithRoles(query);
  }
}
