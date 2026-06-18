import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/** Cross-cutting append-only audit trail (ADR-0006 agent-as-principal aware). */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
