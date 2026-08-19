import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  EMAIL_PROVIDER,
  MAPS_PROVIDER,
  OBJECT_STORAGE,
  MESSENGER_PROVIDER,
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
import { MaxBotAdapter } from './messenger/max-bot.adapter';
import { StubMessengerProvider } from './messenger/stub-messenger.adapter';

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

// ПОСЛАБЛЕНИЕ ПЕРИМЕТРА ГОВОРИТ О СЕБЕ ВСЛУХ ПРИ СТАРТЕ (находка круга 2: тумблер был невидим —
// не в схеме, не в журнале, и «строго в бою» держалось на том, что никто не вписал строку).
// Печатаем ОДИН раз при загрузке модуля: молчащее послабление хуже отсутствующего.
{
  const raw = (process.env.ALLOW_LOCAL_STAND_HOSTS ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') {
    log.warn(
      'ПЕРИМЕТР ОСЛАБЛЕН: ALLOW_LOCAL_STAND_HOSTS включён — дверь пускает односегментные имена ' +
        'стендов (mock-sms, minio). В боевой конфигурации этого флага быть не должно; ось 7 ' +
        'CI-гейта краснеет, если он найден в .env, docker-compose или gen-env.sh.',
    );
  }
}

const messengerProvider: Provider = {
  provide: MESSENGER_PROVIDER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService) => {
    if (cfg.get('MESSENGER_PROVIDER') === 'max' && cfg.get('MAX_BOT_TOKEN')) {
      log.log('Messenger provider: MAX Bot API');
      // Предупреждаем ЗАРАНЕЕ, а не после падения: домен MAX подписан НУЦ Минцифры, которого нет
      // в хранилище доверия по умолчанию. Разрешённый хост ≠ работающий канал.
      // УСЛОВИЕ ИДЁТ ЗА ТЕКСТОМ, А НЕ НАОБОРОТ. Круг 2 переписал текст с «переменная не задана» на
      // ЗАПРЕТ её задавать, а условие оставил прежним — и предупреждение стало приходить ровно тому,
      // кто НИЧЕГО не сделал, и молчать для того, кто выставил опасную переменную (найдено кругом 3).
      if (process.env.NODE_EXTRA_CA_CERTS) {
        log.warn(
          'MAX включён. Домен platform-api2.max.ru подписан НУЦ Минцифры (замерено 17.08.2026), ' +
            'и без российского корня TLS не поднимется. НО доверие добавлять УЗКИМ БАНДЛОМ НА ЭТОТ ' +
            'ВЫЗОВ, а не NODE_EXTRA_CA_CERTS: переменная процесса расширит доверие для БД, кэша, ' +
            'хранилища и ВСЕХ вендоров разом. И прежде чем добавлять корень — сверьте издателя и ' +
            'отпечаток: тот же класс ошибки даёт перехват соединения.',
        );
      }
      return new MaxBotAdapter(cfg.get('MAX_BOT_TOKEN'));
    }
    log.warn('Messenger provider: STUB (no bot token configured)');
    return new StubMessengerProvider();
  },
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
  providers: [
    smsProvider,
    emailProvider,
    mapsProvider,
    objectStorage,
    paymentProvider,
    messengerProvider,
  ],
  exports: [
    SMS_PROVIDER,
    EMAIL_PROVIDER,
    MAPS_PROVIDER,
    OBJECT_STORAGE,
    PAYMENT_PROVIDER,
    MESSENGER_PROVIDER,
  ],
})
export class ProvidersModule {}
