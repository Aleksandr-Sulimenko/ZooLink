import { Module } from '@nestjs/common';
import { AnimalController } from './animal.controller';
import { AnimalService } from './animal.service';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';

/**
 * Animal domain (ADR-0004 animal-as-aggregate).
 * - Slice 1: aggregate CRUD (create/read/update/list/deactivate/reactivate) per animals-api.yaml.
 * - Slice 2: ownership transfer + history (transfers-api.yaml / ADR-0013) — initiate/accept/decline/
 *   cancel/get/list + the settled ownership-history read. The accept path re-attributes the animal
 *   atomically under the `app.ownership_transfer` GUC.
 * Builds on the platform foundation — AuditLogService (agent-as-principal), AbilityFactory (CASL,
 * global), PrismaService — and the global auth guards.
 */
@Module({
  controllers: [AnimalController, TransferController],
  providers: [AnimalService, TransferService],
  exports: [AnimalService, TransferService],
})
export class AnimalModule {}
