import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { AppConfigService } from '../../config/app-config.service';
import type { DB } from './kysely.types';

/**
 * Typed raw-SQL query builder (ADR-0007 escape hatch). Use for radius/geo search,
 * recursive pedigree (WITH RECURSIVE), JSONB containment/aggregation — never string interpolation.
 *
 * Note: Prisma manages its own internal pool and does not expose it, so Kysely owns a small
 * dedicated pg Pool over the same DATABASE_URL. Keep this pool small; PgBouncer (txn mode) sits
 * in front in higher environments (ADR-0007 / performance_specification.md).
 */
@Injectable()
export class KyselyService extends Kysely<DB> implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(KyselyService.name);
  private readonly pool: Pool;

  constructor(config: AppConfigService) {
    const pool = new Pool({
      connectionString: config.get('DATABASE_URL'),
      max: 10,
    });
    super({ dialect: new PostgresDialect({ pool }) });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    // Validate connectivity early so misconfiguration fails fast at boot.
    await this.pool.query('SELECT 1');
    KyselyService.logger.log('Kysely connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy();
    KyselyService.logger.log('Kysely disconnected');
  }
}
