import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../lib/auth/roles.decorator';
import type { Paginated } from '../../lib/pagination/page';
import { AuditService } from './audit.service';
import { ListAuditLogQueryDto, type AuditLogEntry } from './dto/audit-log.dto';

/**
 * Admin Audit-log viewer (admin-api.yaml getAuditLog, Admin Slice 2) under /v1/audit/log.
 * ADMIN-only (@Roles('ADMIN') + global JwtAuthGuard/RolesGuard → 401 unauth / 403 wrong role).
 * Read-only over the append-only audit_log. Filters: entityType, entityId XOR entityIdInt (both → 400),
 * actorId, actionType, date range, page/limit. Each entry carries the {actorId, principalType} badge.
 */
@ApiTags('admin-audit-log')
@Roles('ADMIN')
@Controller({ path: 'audit/log', version: '1' })
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @ApiOperation({ summary: '[ADMIN] List audit-log entries (entityId XOR entityIdInt; both → 400)' })
  list(@Query() query: ListAuditLogQueryDto): Promise<Paginated<AuditLogEntry>> {
    return this.service.list(query);
  }
}
