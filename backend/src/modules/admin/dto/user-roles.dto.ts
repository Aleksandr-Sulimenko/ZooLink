import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Role } from '../../../lib/auth/principal';

/** Parse the string query value 'true'/'false' into a real boolean (class-transformer's Boolean() is unsafe). */
function toBool({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // leave anything else to @IsBoolean to reject
}

/** 7-role canon (rbac-matrix.md; mirrors users.role CHECK). */
export const ROLES = ['USER', 'MODERATOR', 'ADMIN', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER'] as const;

/** Query for GET /users/roles (admin-api.yaml getUsersWithRoles, ADMIN-only). */
export class ListUsersWithRolesQueryDto {
  @ApiPropertyOptional({ enum: ROLES, description: 'Filter by role' })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ maxLength: 100, description: 'Search by full name or email (ILIKE)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/**
 * Wire shape of one user-with-role (admin-api.yaml UserRoleInfo). A safe admin projection — never
 * exposes credentials/identifiers (phone_hash, oauth ids, password_hash).
 */
export interface UserRoleInfo {
  id: string;
  fullName: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  cityId: number | null;
  avatarUrl: string | null;
}
