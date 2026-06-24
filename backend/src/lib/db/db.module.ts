import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { KyselyService } from './kysely.service';

/** Global data-access layer: Prisma (CRUD) + Kysely (typed raw SQL) — ADR-0007. */
@Global()
@Module({
  providers: [PrismaService, KyselyService],
  exports: [PrismaService, KyselyService],
})
export class DbModule {}
