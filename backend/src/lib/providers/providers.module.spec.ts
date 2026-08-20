import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../../config/config.module';
import {
  ProvidersModule,
  standHostsWarning,
  extraCaCertsWarning,
  maxTrustRootWarning,
} from './providers.module';
import {
  EMAIL_PROVIDER,
  MAPS_PROVIDER,
  OBJECT_STORAGE,
  PAYMENT_PROVIDER,
  SMS_PROVIDER,
} from './provider.tokens';
import { StubSmsProvider } from './sms/stub-sms.adapter';
import { StubEmailProvider } from './email/stub-email.adapter';
import { StubMapsProvider } from './maps/stub-maps.adapter';
import { S3ObjectStorage } from './storage/s3.adapter';
import { StubPaymentProvider } from './payment/stub-payment.adapter';

/**
 * With the dev/test env (no provider credentials), comms adapters fall back to stubs while
 * object storage stays live (S3 connectivity is a required env). Payments are always stubbed
 * in the MVP.
 */
describe('ProvidersModule (default env selection)', () => {
  it('resolves stubs for SMS/email/maps, live S3 storage, and stub payments', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, ProvidersModule],
    }).compile();

    expect(moduleRef.get(SMS_PROVIDER)).toBeInstanceOf(StubSmsProvider);
    expect(moduleRef.get(EMAIL_PROVIDER)).toBeInstanceOf(StubEmailProvider);
    expect(moduleRef.get(MAPS_PROVIDER)).toBeInstanceOf(StubMapsProvider);
    expect(moduleRef.get(OBJECT_STORAGE)).toBeInstanceOf(S3ObjectStorage);

    const payment = moduleRef.get<StubPaymentProvider>(PAYMENT_PROVIDER);
    expect(payment).toBeInstanceOf(StubPaymentProvider);
    expect(payment.available).toBe(false);
    await expect(
      payment.createPayment({
        amountMinor: 1000,
        currency: 'RUB',
        description: 'x',
        idempotencyKey: 'k',
        returnUrl: 'https://zoolink.ru/return',
      }),
    ).rejects.toThrow(/payments are disabled/);

    await moduleRef.close();
  });
});

/**
 * ОСЬ НА ТЕКСТ ПРЕДУПРЕЖДЕНИЙ ПРОВОДКИ (круг 4, находки «оба предупреждения не стережёт ничто» и
 * «предупреждение привязано к включённому каналу, а опасность от него не зависит»).
 * До этой оси мутации M9 (вернуть перевёрнутое условие) и M13 (убить предупреждение о послаблении
 * периметра) проходили ЗЕЛЁНЫМИ на 546 тестах: свод проводки судил только разрешение зависимостей.
 * Проверяем ЧТО СКАЗАНО ЧЕЛОВЕКУ, а не только rc.
 */
describe('предупреждения проводки — текст и условие (круг 4)', () => {
  it('послабление периметра: молчит без флага, говорит при 1/true/yes', () => {
    expect(standHostsWarning({})).toBeNull();
    expect(standHostsWarning({ ALLOW_LOCAL_STAND_HOSTS: 'false' })).toBeNull();
    for (const v of ['1', 'true', 'YES', ' true ']) {
      const t = standHostsWarning({ ALLOW_LOCAL_STAND_HOSTS: v });
      expect(t).toContain('ПЕРИМЕТР ОСЛАБЛЕН');
      expect(t).toContain('ALLOW_LOCAL_STAND_HOSTS');
    }
  });

  it('NODE_EXTRA_CA_CERTS: предупреждение НЕ ЗАВИСИТ от мессенджера и называет радиус доверия', () => {
    expect(extraCaCertsWarning({})).toBeNull();
    expect(extraCaCertsWarning({ NODE_EXTRA_CA_CERTS: '  ' })).toBeNull();
    const t = extraCaCertsWarning({ NODE_EXTRA_CA_CERTS: '/etc/ssl/ru.pem' });
    expect(t).toContain('NODE_EXTRA_CA_CERTS');
    expect(t).toContain('БД'); // радиус назван поимённо, а не «расширяет доверие» вообще
    expect(t).toContain('УЗКИМ БАНДЛОМ'); // сказано, ЧТО делать вместо
    expect(t).toContain('отпечаток'); // тот же класс ошибки даёт перехват — сверить издателя
  });

  it('доверие к корню при живом MAX: текст БЕЗУСЛОВЕН и назван хостом с датой замера', () => {
    const t = maxTrustRootWarning();
    expect(t).toContain('platform-api2.max.ru'); // хост, а не «домен MAX»: свойство хоста
    expect(t).toContain('17.08.2026'); // замер имеет дату — иначе он не перемеряется
    expect(t).toContain('УЗКИМ БАНДЛОМ');
    expect(t).toContain('botapi.max.ru'); // сменили хост — перемерьте, там корень ВРЕДЕН
    expect(t).not.toMatch(/если .{0,20}NODE_EXTRA_CA_CERTS задан/i);
  });

  it('модуль ЗОВЁТ эти функции, а не хранит их мёртвыми: при флаге стенда предупреждение печатается', async () => {
    const prev = process.env.ALLOW_LOCAL_STAND_HOSTS;
    const prevCa = process.env.NODE_EXTRA_CA_CERTS;
    process.env.ALLOW_LOCAL_STAND_HOSTS = 'true';
    // КАНАЛ СПИТ (MESSENGER_PROVIDER не 'max'), А ПЕРЕМЕННАЯ ЗАДАНА — самая частая и прежде молчащая
    // конфигурация: опасность доверия процесса от мессенджера не зависит (находка круга 4).
    process.env.NODE_EXTRA_CA_CERTS = '/etc/ssl/россия.pem';
    const сказано: string[] = [];
    try {
      jest.resetModules();
      await jest.isolateModulesAsync(async () => {
        // ШПИОН СТАВИТСЯ НА ТОТ ЖЕ ЭКЗЕМПЛЯР БИБЛИОТЕКИ, ЧТО УВИДИТ МОДУЛЬ. Первая попытка следила
        // за Logger из верхнего импорта — а изолированный реестр отдаёт модулю ДРУГУЮ копию
        // @nestjs/common, и шпион молчал при исправном коде (ложно-красная ось, поймана при её же
        // написании). Поэтому импортируем библиотеку ВНУТРИ изоляции и следим за ней.
        const nest = await import('@nestjs/common');
        jest
          .spyOn(nest.Logger.prototype, 'warn')
          .mockImplementation((msg: unknown) => void сказано.push(String(msg)));
        const m = await import('./providers.module');
        expect(m.ProvidersModule).toBeDefined();
      });
      expect(сказано.join('\n')).toContain('ПЕРИМЕТР ОСЛАБЛЕН');
      expect(сказано.join('\n')).toContain('ДОВЕРИЕ ПРОЦЕССА РАСШИРЕНО');
    } finally {
      if (prev === undefined) delete process.env.ALLOW_LOCAL_STAND_HOSTS;
      else process.env.ALLOW_LOCAL_STAND_HOSTS = prev;
      if (prevCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = prevCa;
      jest.restoreAllMocks();
    }
  });

  it('живой MAX предупреждает о доверии к корню БЕЗ всяких условий (M9: условие вернули — ось краснеет)', async () => {
    const prevP = process.env.MESSENGER_PROVIDER;
    const prevT = process.env.MAX_BOT_TOKEN;
    const prevCa = process.env.NODE_EXTRA_CA_CERTS;
    process.env.MESSENGER_PROVIDER = 'max';
    process.env.MAX_BOT_TOKEN = 'тест-токен-не-настоящий';
    delete process.env.NODE_EXTRA_CA_CERTS; // САМЫЙ ЧАСТЫЙ СЛУЧАЙ: человек просто включил канал
    const сказано: string[] = [];
    try {
      jest.resetModules();
      await jest.isolateModulesAsync(async () => {
        const nest = await import('@nestjs/common');
        jest
          .spyOn(nest.Logger.prototype, 'warn')
          .mockImplementation((msg: unknown) => void сказано.push(String(msg)));
        const { Test: T } = await import('@nestjs/testing');
        const { AppConfigModule: C } = await import('../../config/config.module');
        const { ProvidersModule: P } = await import('./providers.module');
        const { MESSENGER_PROVIDER: TOKEN } = await import('./provider.tokens');
        const { MaxBotAdapter: A } = await import('./messenger/max-bot.adapter');
        const ref = await T.createTestingModule({ imports: [C, P] }).compile();
        expect(ref.get(TOKEN)).toBeInstanceOf(A);
      });
      const всё = сказано.join('\n');
      expect(всё).toContain('platform-api2.max.ru');
      expect(всё).toContain('УЗКИМ БАНДЛОМ');
      // и НЕ печатаем предупреждение про переменную, которой нет — иначе совет теряет адресата
      expect(всё).not.toContain('ДОВЕРИЕ ПРОЦЕССА РАСШИРЕНО');
    } finally {
      for (const [k, v] of [
        ['MESSENGER_PROVIDER', prevP],
        ['MAX_BOT_TOKEN', prevT],
        ['NODE_EXTRA_CA_CERTS', prevCa],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      jest.restoreAllMocks();
    }
  });
});
