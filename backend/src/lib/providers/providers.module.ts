import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  EMAIL_PROVIDER,
  MAPS_PROVIDER,
  OBJECT_STORAGE,
  PAYMENT_PROVIDER,
  SMS_PROVIDER,
} from './provider.tokens';
import { SmsRuAdapter } from './sms/smsru.adapter';
import { StubSmsProvider } from './sms/stub-sms.adapter';
import { UnisenderAdapter } from './email/unisender.adapter';
import { StubEmailProvider } from './email/stub-email.adapter';
import { YandexMapsAdapter } from './maps/yandex-maps.adapter';
import { StubMapsProvider } from './maps/stub-maps.adapter';
import { S3ObjectStorage } from './storage/s3.adapter';
import { StubPaymentProvider } from './payment/stub-payment.adapter';

const log = new Logger('ProvidersModule');

const smsProvider: Provider = {
  provide: SMS_PROVIDER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService) => {
    if (cfg.get('SMS_PROVIDER') === 'smsru' && cfg.get('SMSRU_API_ID')) {
      log.log('SMS provider: SMS.RU');
      return new SmsRuAdapter(cfg.get('SMSRU_API_ID'), cfg.get('SMS_FROM'));
    }
    log.warn('SMS provider: STUB (no credential configured)');
    return new StubSmsProvider();
  },
};

const emailProvider: Provider = {
  provide: EMAIL_PROVIDER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService) => {
    if (cfg.get('EMAIL_PROVIDER') === 'unisender' && cfg.get('UNISENDER_API_KEY') && cfg.get('EMAIL_FROM')) {
      log.log('Email provider: Unisender');
      return new UnisenderAdapter({
        apiKey: cfg.get('UNISENDER_API_KEY'),
        fromEmail: cfg.get('EMAIL_FROM'),
        fromName: cfg.get('EMAIL_FROM_NAME'),
        listId: cfg.get('UNISENDER_LIST_ID'),
      });
    }
    log.warn('Email provider: STUB (no credential / sender configured)');
    return new StubEmailProvider();
  },
};

const mapsProvider: Provider = {
  provide: MAPS_PROVIDER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService) => {
    if (cfg.get('YANDEX_MAPS_API_KEY')) {
      log.log('Maps provider: Yandex.Maps');
      return new YandexMapsAdapter(cfg.get('YANDEX_MAPS_API_KEY'));
    }
    log.warn('Maps provider: STUB (no key configured)');
    return new StubMapsProvider();
  },
};

const objectStorage: Provider = {
  provide: OBJECT_STORAGE,
  inject: [AppConfigService],
  // S3 connectivity (endpoint/keys/bucket) is required by env validation, so storage is
  // always live — MinIO in dev, Yandex Object Storage in prod.
  useFactory: (cfg: AppConfigService) =>
    new S3ObjectStorage({
      endpoint: cfg.get('S3_ENDPOINT'),
      region: cfg.get('S3_REGION'),
      accessKey: cfg.get('S3_ACCESS_KEY'),
      secretKey: cfg.get('S3_SECRET_KEY'),
      bucket: cfg.get('S3_BUCKET'),
    }),
};

const paymentProvider: Provider = {
  // Always stub in the MVP; the real ЮKassa adapter arrives with feature_toggles.payments.
  provide: PAYMENT_PROVIDER,
  useFactory: () => new StubPaymentProvider(),
};

/**
 * Phase-1 cross-cutting layer: every external capability behind a port (ADR-0008).
 * Vendor vs stub is chosen here from config; domain modules inject the token only and
 * never touch a concrete vendor.
 */
@Global()
@Module({
  providers: [smsProvider, emailProvider, mapsProvider, objectStorage, paymentProvider],
  exports: [SMS_PROVIDER, EMAIL_PROVIDER, MAPS_PROVIDER, OBJECT_STORAGE, PAYMENT_PROVIDER],
})
export class ProvidersModule {}
