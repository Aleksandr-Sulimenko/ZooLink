import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { MAX_API_HOST, standHostsToggleOn } from '../../config/env.validation';
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

/**
 * ПОЧЕМУ КАНАЛ СПИТ — ОТВЕТ НАЗЫВАЕТ ПРИЧИНУ, А НЕ ПЕРВУЮ ИЗ ДВУХ (находка №123).
 *
 * ЧТО БЫЛО ЗАМЕРЕНО. Все три шва печатали ОДИН текст на ДВЕ разные причины, и напечатанная была
 * ложной во втором случае: `MESSENGER_PROVIDER=MAX` (заглавными — так называется площадка) при
 * ЖИВОМ токене давало «no bot token configured». Схема имя провайдера не enum'ит (это риск,
 * ПРИНЯТЫЙ держателем, находка №13) — значит «Max», «MAX», «maks» проходят загрузку молча и
 * доходят сюда. Оператор читает про токен, которого не трогал, перевыпускает его у площадки,
 * кладёт заново, перезапускает и получает ТУ ЖЕ строку: отличить причины по тексту нельзя ПО
 * ПОСТРОЕНИЮ — сообщение не называло ни прочитанное имя, ни того, что имя вообще проверялось.
 * Ровно этот класс стоил соседнему треку недели 17–24.08.
 *
 * ЛЕЧИМ ВСЕ ТРИ ШВА, А НЕ ОДИН: у СМС и почты та же ложь теми же словами — вылечив мессенджер в
 * одиночку, мы оставили бы соседей с ней и научили читателя, что класс закрыт.
 *
 * ИМЯ ПРОВАЙДЕРА — НЕ СЕКРЕТ и печатается ДОСЛОВНО (в кавычках, чтобы пробел был виден); ключи и
 * токены не печатаются НИКОГДА — про них говорится только «пусто/задано».
 */
export function причинаЗаглушки(
  переменная: string,
  прочитанное: string,
  ожидаемое: string,
  чегоНеХватает: string,
): string {
  if (прочитанное !== ожидаемое) {
    return (
      `${переменная}=«${прочитанное}» — сверка ТОЧНАЯ, ожидается «${ожидаемое}» (регистр и ` +
      'пробелы значимы). Учётные данные при этом НЕ ПРОВЕРЯЛИСЬ: до них дело не дошло.'
    );
  }
  return `${переменная}=«${ожидаемое}», но ${чегоНеХватает}`;
}

const smsProvider: Provider = {
  provide: SMS_PROVIDER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService) => {
    if (cfg.get('SMS_PROVIDER') === 'smsru' && cfg.get('SMSRU_API_ID')) {
      log.log('SMS provider: SMS.RU');
      return new SmsRuAdapter(cfg.get('SMSRU_API_ID'), cfg.get('SMS_FROM'));
    }
    log.warn(
      'SMS provider: STUB — ' +
        причинаЗаглушки('SMS_PROVIDER', cfg.get('SMS_PROVIDER'), 'smsru', 'SMSRU_API_ID пуст'),
    );
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
    log.warn(
      'Email provider: STUB — ' +
        причинаЗаглушки(
          'EMAIL_PROVIDER',
          cfg.get('EMAIL_PROVIDER'),
          'unisender',
          'пусты UNISENDER_API_KEY и/или EMAIL_FROM',
        ),
    );
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

/**
 * ТЕКСТЫ ПРЕДУПРЕЖДЕНИЙ ВЫНЕСЕНЫ В ЧИСТЫЕ ФУНКЦИИ, ЧТОБЫ ИХ БЫЛО ЧЕМ ПРОВЕРИТЬ.
 * До круга 4 оба предупреждения жили inline, и мутации M9/M13 (вернуть перевёрнутое условие ·
 * убить предупреждение о послаблении периметра) прошли ЗЕЛЁНЫМИ на 546 тестах: свод проводки
 * проверяет РАЗРЕШЕНИЕ ЗАВИСИМОСТЕЙ и ничего не знает о том, что модуль говорит человеку.
 * Функция возвращает текст или null; модуль её ЗОВЁТ и печатает. Ось стоит на ТЕКСТЕ.
 */

/**
 * Послабление периметра говорит о себе вслух при старте (находка круга 2: тумблер был невидим).
 * Условие — ЕДИНСТВЕННЫЙ разбор тумблера (`standHostsToggleOn`, находка №165 круга 5): до этого
 * здесь жила ТРЕТЬЯ копия словаря своими литералами, и мутация словаря двери оставляла
 * предупреждение молчащим при уже расширенном периметре — согласие копий не стерегла ни одна ось.
 */
export function standHostsWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!standHostsToggleOn(env.ALLOW_LOCAL_STAND_HOSTS)) return null;
  return (
    'ПЕРИМЕТР ОСЛАБЛЕН: ALLOW_LOCAL_STAND_HOSTS включён — дверь пускает односегментные имена ' +
    'стендов (mock-sms, minio). В боевой конфигурации этого флага быть не должно; ось 7 ' +
    'CI-гейта краснеет, если он найден в .env, docker-compose или gen-env.sh.'
  );
}

/**
 * ОПАСНОСТЬ ПЕРЕМЕННОЙ НЕ ЗАВИСИТ ОТ КАНАЛА — поэтому и предупреждение не зависит (находка круга 4).
 * NODE_EXTRA_CA_CERTS расширяет доверие процесса для БД, кэша, хранилища и ВСЕХ вендоров разом,
 * независимо от того, включён ли MAX. Прежде оно висело ВНУТРИ ветки живого мессенджера, а канал по
 * умолчанию спит (токен пуст → заглушка) — значит самая частая конфигурация была опасной и молчащей.
 */
export function extraCaCertsWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.NODE_EXTRA_CA_CERTS ?? '').trim();
  if (raw === '') return null;
  return (
    'ДОВЕРИЕ ПРОЦЕССА РАСШИРЕНО: NODE_EXTRA_CA_CERTS задан — добавленный корень действует НЕ на ' +
    'один вызов, а на БД, кэш, хранилище и ВСЕХ вендоров разом. Если корень нужен ровно одному ' +
    'хосту, подключайте его УЗКИМ БАНДЛОМ на этот вызов и снимите переменную. И прежде чем ' +
    'доверять корню — сверьте издателя и отпечаток предъявленного сертификата: тот же класс ' +
    'ошибки TLS даёт перехват соединения.'
  );
}

/**
 * ПРЕДУПРЕЖДАЕМ ЗАРАНЕЕ, А НЕ ПОСЛЕ ПАДЕНИЯ, И ТЕПЕРЬ — ВСЕГДА ПРИ ЖИВОМ КАНАЛЕ.
 * Круг 3 привязал этот текст к условию «переменная задана», и предупреждение стало приходить ровно
 * тому, кто уже сделал опасное, и молчать для того, кто просто включил канал (находка круга 4).
 * Разрешённый хост ≠ работающий канал: свойство принадлежит ХОСТУ, а не «домену MAX» — замер 17.08
 * показал, что botapi.max.ru и platform-api.max.ru живут на СИСТЕМНЫХ корнях, и русский корень им
 * вреден. Поэтому текст называет хост и дату замера, а не «домен MAX».
 */
export function maxTrustRootWarning(): string {
  return (
    `MAX включён. Хост ${MAX_API_HOST} подписан НУЦ Минцифры (замерено 17.08.2026), и без ` +
    'российского корня TLS не поднимется — разрешённый хост ещё не значит работающий канал. ' +
    'Доверие добавлять УЗКИМ БАНДЛОМ НА ЭТОТ ВЫЗОВ, а не NODE_EXTRA_CA_CERTS. Сменили хост — ' +
    'перемерьте: у botapi.max.ru издатель обычный, и русский корень там ЛОМАЕТ доверие.'
  );
}

// Печатаем ОДИН раз при загрузке модуля: молчащее послабление хуже отсутствующего.
for (const text of [standHostsWarning(), extraCaCertsWarning()]) {
  if (text !== null) log.warn(text);
}

const messengerProvider: Provider = {
  provide: MESSENGER_PROVIDER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService) => {
    if (cfg.get('MESSENGER_PROVIDER') === 'max' && cfg.get('MAX_BOT_TOKEN')) {
      log.log('Messenger provider: MAX Bot API');
      log.warn(maxTrustRootWarning());
      return new MaxBotAdapter(cfg.get('MAX_BOT_TOKEN'));
    }
    log.warn(
      'Messenger provider: STUB — ' +
        причинаЗаглушки(
          'MESSENGER_PROVIDER',
          cfg.get('MESSENGER_PROVIDER'),
          'max',
          'MAX_BOT_TOKEN пуст',
        ),
    );
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
