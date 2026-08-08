import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { installProcessGuards } from './lib/observability/process-guards';
import { WorkerModule } from './worker.module';

/**
 * Background process entrypoint (separate from the HTTP API). Hosts the outbox relay, cron,
 * and async jobs (Phase 1+). Runs as its own container in docker-compose (`worker`).
 * Phase 0: boots the platform context and idles, proving the second entrypoint works.
 */
async function bootstrap(): Promise<void> {
  // Same startup-survival guard as the API (AUDIT5 §F1c): the worker shares RedisService, so it went
  // down the same way when Redis was unreachable at boot, in its own restart loop. No error sink is
  // passed because the worker never initialised Sentry (unchanged here) — the rejection is logged.
  installProcessGuards();

  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const logger = await app.resolve(PinoLogger);
  logger.log('Worker started (outbox relay + scheduler registered)');
}

void bootstrap();
