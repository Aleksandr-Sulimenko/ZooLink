import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { API_VERSION, applyGlobalApiPrefix } from './config/api-base';
import { AppConfigService } from './config/app-config.service';
import { ProblemExceptionFilter } from './lib/http/problem.filter';
import { installProcessGuards } from './lib/observability/process-guards';
import { Sentry, initSentry } from './lib/observability/sentry';

async function bootstrap(): Promise<void> {
  // Sentry must initialize before anything else can throw, so it reads RAW env — this runs BEFORE
  // validateEnv. initSentry therefore carries its own ADR-0017 п.6 residency check on the DSN host
  // (a boot-time-only check would arrive after the first report had already been shipped abroad).
  // NODE_ENV defaults to 'production' here for the same fail-SAFE reason as in env.validation.ts: an
  // unset NODE_ENV must not silently unlock the dev residency bypass on the more permissive path.
  initSentry({
    SENTRY_DSN: process.env.SENTRY_DSN ?? '',
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') ?? 'production',
    RESIDENCY_ALLOW_NON_RF_DEV: process.env.RESIDENCY_ALLOW_NON_RF_DEV === 'true',
  });

  // Installed BEFORE bootstrap so a rejection during startup is reported instead of killing the
  // process (AUDIT5 §F1c). Sentry is already initialized above, so the report has somewhere to go.
  installProcessGuards({ capture: (error) => Sentry.captureException(error) });

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

  // Global route prefix `api` (single source: config/api-base) → the product routes are served at
  // /api/v1/*, matching the published contract base (`servers:` ×13 + API_CONVENTIONS) and Caddy's
  // non-stripping `handle /api/*`. Health & metrics opt out (API_PREFIX_EXCLUDE) so the container
  // healthcheck and the ops scrape keep their version-neutral root paths.
  applyGlobalApiPrefix(app);

  // URI versioning: product routes live under /api/v1/* (health/metrics are version-neutral).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  // CORS. Same-origin in production (ADR-0009: the SPA is served by the same Caddy on the same
  // domain → no CORS needed), so it is enabled ONLY when explicit origins are configured — chiefly
  // cross-origin LOCAL development (a SPA dev-server on another port). Never a wildcard: `credentials`
  // is on so the refresh cookie can ride a cross-origin request, which requires an EXACT allowed
  // origin. The allowlist is the sole CORS knob; the public base itself stays in config/api-base.
  const corsOrigins = config
    .get('CORS_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }

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
