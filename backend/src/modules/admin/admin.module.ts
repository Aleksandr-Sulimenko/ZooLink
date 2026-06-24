import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OptionalJwtGuard } from '../../lib/auth/optional-jwt.guard';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';

/**
 * Admin domain (Phase 2). Slice 1: Reference Data management (species/breeds/cities CRUD per
 * admin-api.yaml; UC-AD-03). Moderation/system-settings/user-roles arrive in later slices once the
 * Animal/Marketplace domains exist. Builds on the platform foundation: PrismaService, AuditLogService,
 * AuthModule guards (RolesGuard/JwtAuthGuard), IdempotencyInterceptor (RedisService).
 */
@Module({
  imports: [AuthModule],
  controllers: [ReferenceDataController],
  providers: [ReferenceDataService, OptionalJwtGuard],
})
export class AdminModule {}
