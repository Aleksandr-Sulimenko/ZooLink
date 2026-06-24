import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * Background process entrypoint (separate from the HTTP API). Hosts the outbox relay, cron,
 * and async jobs (Phase 1+). Runs as its own container in docker-compose (`worker`).
 * Phase 0: boots the platform context and idles, proving the second entrypoint works.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const logger = await app.resolve(PinoLogger);
  logger.log('Worker started (outbox relay + scheduler registered)');
}

void bootstrap();
