import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Structured JSON logging (Pino) with request-id propagation and PII redaction
 * per docs/specs/data-governance.md. Pretty output only in non-production.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: (req, res) => {
            const existing = req.headers['x-request-id'];
            const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // PII redaction (FZ-152 / data-governance.md): never log secrets or personal data.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'req.body.password',
              'req.body.otp',
              'req.body.code',
              'req.body.token',
              'req.body.refreshToken',
              'req.body.phone',
              'req.body.email',
              '*.password',
              '*.phone_hash',
              '*.passwordHash',
              '*.accessToken',
              '*.refreshToken',
            ],
            censor: '[REDACTED]',
          },
          transport: config.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
