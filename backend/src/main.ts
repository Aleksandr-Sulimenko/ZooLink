import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { ProblemExceptionFilter } from './lib/http/problem.filter';
import { initSentry } from './lib/observability/sentry';

async function bootstrap(): Promise<void> {
  // Sentry must initialize before anything else can throw. Reads raw env (validated inside Nest).
  initSentry({
    SENTRY_DSN: process.env.SENTRY_DSN ?? '',
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') ?? 'development',
  });

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Pino as the application logger (structured JSON + PII redaction).
  app.useLogger(app.get(PinoLogger));

  const config = app.get(AppConfigService);

  // Global input validation: strip unknown props, reject extras, auto-transform DTOs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // RFC 7807 error envelope for every thrown error.
  app.useGlobalFilters(new ProblemExceptionFilter());

  // URI versioning: routes live under /v1/* (health endpoints opt out below).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableShutdownHooks();

  // OpenAPI / Swagger (served only outside production).
  if (!config.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ZooLink API')
      .setDescription('ZooLink MVP backend — see docs/03-architecture/api-contracts')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('PORT');
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
