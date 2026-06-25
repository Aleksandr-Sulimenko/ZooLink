import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { OptionalJwtGuard } from '../../lib/auth/optional-jwt.guard';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { UserRolesController } from './user-roles.controller';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { SystemSettingController } from './system-setting.controller';
import { SystemSettingService } from './system-setting.service';

/**
 * Admin domain (Phase 2).
 * - Slice 1: Reference Data management (species/breeds/cities CRUD per admin-api.yaml; UC-AD-03).
 * - Slice 2: Users & Roles list (getUsersWithRoles — reuses identity AdminUserService) + Audit-log
 *   viewer (getAuditLog — reads the append-only ledger via AuditLogService.query). Both ADMIN-only.
 * - Slice 3: System Settings (getSystemSettings / updateSystemSetting — reuses FeatureToggleService.flip
 *   for the atomic+audited write, adds If-Match/ETag). ADMIN-only.
 * Builds on the platform foundation: PrismaService, AuditLogService (@Global), FeatureToggleService
 * (@Global), AuthModule guards (RolesGuard/JwtAuthGuard), IdempotencyInterceptor (RedisService).
 */
@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [ReferenceDataController, UserRolesController, AuditController, SystemSettingController],
  providers: [ReferenceDataService, AuditService, SystemSettingService, OptionalJwtGuard],
})
export class AdminModule {}
