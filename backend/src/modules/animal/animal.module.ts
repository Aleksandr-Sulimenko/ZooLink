import { Module } from '@nestjs/common';
import { AnimalController } from './animal.controller';
import { AnimalService } from './animal.service';

/**
 * Animal domain (ADR-0004 animal-as-aggregate). Slice 1: aggregate CRUD (create/read/update/list/
 * deactivate/reactivate) per animals-api.yaml. Builds on the platform foundation — AuditLogService
 * (agent-as-principal), AbilityFactory (CASL, global), PrismaService — and the global auth guards.
 * Ownership transfer + ownership-history reads land in a later slice.
 */
@Module({
  controllers: [AnimalController],
  providers: [AnimalService],
  exports: [AnimalService],
})
export class AnimalModule {}
