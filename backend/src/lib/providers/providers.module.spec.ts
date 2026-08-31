import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../../config/config.module';
import {
  ProvidersModule,
  standHostsWarning,
  extraCaCertsWarning,
  maxTrustRootWarning,
  причинаЗаглушки,
} from './providers.module';
import {
  MAX_API_HOST,
  STAND_HOSTS_TOGGLE_ON,
  STAND_HOSTS_TOGGLE_OFF,
} from '../../config/env.validation';
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
  it('послабление периметра: условие судится СЛОВАРЁМ тумблера, а не своей копией (находка №165)', () => {
    // Пробы берутся из ЕДИНСТВЕННОГО словаря (env.validation), а не переписаны рукой: рукописный
    // перечень здесь и был третьей копией — расхождение с дверью он проверить не мог по построению.
    expect(standHostsWarning({})).toBeNull();
    for (const v of STAND_HOSTS_TOGGLE_ON) {
      for (const dressed of [v, v.toUpperCase(), ` ${v} `]) {
        const t = standHostsWarning({ ALLOW_LOCAL_STAND_HOSTS: dressed });
        expect(t).toContain('ПЕРИМЕТР ОСЛАБЛЕН');
        expect(t).toContain('ALLOW_LOCAL_STAND_HOSTS');
      }
    }
    // ВЫКЛ-половина словаря и значения ВНЕ словаря (включая 'on' — ровно мутант М1 круга 5,
    // на котором дверь расширялась, а это предупреждение молчало) — молчание.
    for (const v of [...STAND_HOSTS_TOGGLE_OFF, 'on', '', '  ', 'да']) {
      expect(standHostsWarning({ ALLOW_LOCAL_STAND_HOSTS: v })).toBeNull();
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
    expect(t).toContain(MAX_API_HOST); // хост, а не «домен MAX»: свойство хоста
    expect(t).toContain('17.08.2026'); // замер имеет дату — иначе он не перемеряется
    expect(t).toContain('УЗКИМ БАНДЛОМ');
    expect(t).toContain('botapi.max.ru'); // сменили хост — перемерьте, там корень ВРЕДЕН
    expect(t).not.toMatch(/если .{0,20}NODE_EXTRA_CA_CERTS задан/i);
  });

  it('🔴 №146: модуль МОЛЧИТ на импорте и ГОВОРИТ в onModuleInit — там, где логгер уже pino', async () => {
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
        // 🔴 НА ИМПОРТЕ — МОЛЧИМ (находка №146). Прежде цикл стоял на верхнем уровне модуля и
        // печатал ЗДЕСЬ — то есть до `NestFactory.create(..., {bufferLogs:true})`, мимо pino:
        // в журнал уходила ANSI-строка Nest ConsoleLogger вместо JSON, и сборщик логов боевого
        // стенда её терял. МУТАНТ (красное-до): вернуть цикл на верхний уровень — ось краснеет.
        expect(сказано.join('\n')).not.toContain('ПЕРИМЕТР ОСЛАБЛЕН');
        // …А В ХУКЕ ЖИЗНЕННОГО ЦИКЛА — ГОВОРИМ. Он идёт ВНУТРИ create(), в окне bufferLogs,
        // значит накопленное отдаётся уже установленному pino.
        new m.ProvidersModule().onModuleInit();
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
      expect(всё).toContain(MAX_API_HOST);
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

/**
 * ═══ ПОЧЕМУ КАНАЛ СПИТ — ОТВЕТ НАЗЫВАЕТ ПРИЧИНУ (страж находки №123) ═══
 *
 * Было замерено: все три шва печатали ОДИН текст на ДВЕ разные причины, и во втором случае он был
 * ЛОЖЕН — «no bot token configured» при живом токене и опечатке в имени провайдера. Отличить
 * причины по тексту было нельзя ПО ПОСТРОЕНИЮ, и оператор уходил чинить то, чего не трогал.
 *
 * ОСЬ МЕРИТ ОБА ПОЛЮСА: (1) неверное ИМЯ — текст говорит про имя и прямо снимает подозрение с
 * учётных данных; (2) верное имя и пустой ключ — текст говорит про ключ. Одного полюса не хватило
 * бы: сообщение «причина неизвестна» прошло бы половину оси.
 */
describe('Заглушка называет ПРИЧИНУ, а не первую из двух (№123)', () => {
  it('🔴 ИМЯ ПРОВАЙДЕРА НАБРАНО ИНАЧЕ — текст говорит про ИМЯ и снимает подозрение с ключа', () => {
    // МУТАНТ (красное-до): вернуть прежнюю константу 'STUB (no bot token configured)' — ось
    // краснеет на обоих полюсах сразу.
    const текст = причинаЗаглушки('MESSENGER_PROVIDER', 'MAX', 'max', 'MAX_BOT_TOKEN пуст');
    expect(текст).toContain('MESSENGER_PROVIDER=«MAX»');
    expect(текст).toContain('ожидается «max»');
    expect(текст).toContain('НЕ ПРОВЕРЯЛИСЬ');
    // НЕСУЩЕЕ: про токен здесь не должно быть НИ СЛОВА — ровно это и уводило оператора.
    expect(текст).not.toContain('MAX_BOT_TOKEN пуст');
  });

  it('🔴 ИМЯ ВЕРНОЕ, КЛЮЧ ПУСТ — текст говорит про КЛЮЧ (законный сон канала)', () => {
    const текст = причинаЗаглушки('MESSENGER_PROVIDER', 'max', 'max', 'MAX_BOT_TOKEN пуст');
    expect(текст).toContain('MAX_BOT_TOKEN пуст');
    expect(текст).not.toContain('ожидается');
  });

  it('🔴 ПРОБЕЛ ВИДЕН: значение печатается в кавычках, иначе « max» неотличимо от «max»', () => {
    // МУТАНТ: убрать кавычки — ось краснеет. Невидимый пробел в .env — живой класс отказов.
    const текст = причинаЗаглушки('MESSENGER_PROVIDER', ' max', 'max', 'MAX_BOT_TOKEN пуст');
    expect(текст).toContain('« max»');
  });

  it('КЛАСС ЗАКРЫТ У ВСЕХ ТРЁХ ШВОВ, а не у одного (СМС и почта — та же ложь теми же словами)', () => {
    for (const [пер, ожид, нет] of [
      ['SMS_PROVIDER', 'smsru', 'SMSRU_API_ID пуст'],
      ['EMAIL_PROVIDER', 'unisender', 'пусты UNISENDER_API_KEY и/или EMAIL_FROM'],
      ['MESSENGER_PROVIDER', 'max', 'MAX_BOT_TOKEN пуст'],
    ]) {
      expect(причинаЗаглушки(пер, 'ОПЕЧАТКА', ожид, нет)).toContain(`${пер}=«ОПЕЧАТКА»`);
      expect(причинаЗаглушки(пер, ожид, ожид, нет)).toContain(нет);
    }
  });

  it('СЕКРЕТ НЕ ПЕЧАТАЕТСЯ НИКОГДА: в тексте только имя переменной, не её значение', () => {
    const текст = причинаЗаглушки('MESSENGER_PROVIDER', 'max', 'max', 'MAX_BOT_TOKEN пуст');
    expect(текст).not.toContain('9f3a1c'); // форма боевого токена
    expect(текст).toMatch(/MAX_BOT_TOKEN пуст$/);
  });
});

/**
 * ОСЬ НА ПРОВОДКУ, А НЕ НА ПОМОЩНИКА (иначе повторили бы находку №5: ось проверяет НАЛИЧИЕ
 * строки, а не поведение). Здесь поднимается НАСТОЯЩИЙ модуль с настоящим окружением, и
 * проверяется то, что увидит оператор в журнале.
 */
describe('№123 на ЖИВОЙ фабрике: канал спит при опечатке в имени — журнал говорит про ИМЯ', () => {
  const поднять = async (env: Record<string, string>) => {
    const было: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) {
      было[k] = process.env[k];
      process.env[k] = env[k];
    }
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
        const { StubMessengerProvider: S } = await import('./messenger/stub-messenger.adapter');
        const ref = await T.createTestingModule({ imports: [C, P] }).compile();
        expect(ref.get(TOKEN)).toBeInstanceOf(S); // канал ДЕЙСТВИТЕЛЬНО спит
      });
    } finally {
      for (const [k, v] of Object.entries(было)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      jest.restoreAllMocks();
    }
    return сказано.join('\n');
  };

  it('🔴 MESSENGER_PROVIDER=«MAX» при ЖИВОМ токене — про токен НЕ СКАЗАНО НИ СЛОВА', async () => {
    // Ровно то, что было сломано: заглавные буквы (так называется площадка) + непустой токен
    // давали «no bot token configured», и оператор перевыпускал токен, которого не трогал.
    const всё = await поднять({
      MESSENGER_PROVIDER: 'MAX',
      MAX_BOT_TOKEN: '9f3a1c-bot-token-91824577',
    });
    expect(всё).toContain('MESSENGER_PROVIDER=«MAX»');
    expect(всё).toContain('ожидается «max»');
    expect(всё).not.toContain('MAX_BOT_TOKEN пуст');
    expect(всё).not.toContain('9f3a1c'); // секрет в журнал не идёт
  });

  it('имя верное, токен пуст — журнал говорит про ТОКЕН (законный сон канала)', async () => {
    const всё = await поднять({ MESSENGER_PROVIDER: 'max', MAX_BOT_TOKEN: '' });
    expect(всё).toContain('MAX_BOT_TOKEN пуст');
    expect(всё).not.toContain('ожидается');
  });
});

/**
 * ═══ СОВЕТ «СМЕНИТЕ ХОСТ» ИСПОЛНИМ ЦЕЛИКОМ (страж находки №142) ═══
 *
 * Замер находки: оба рабочих хоста флота дверь ОТВЕРГАЕТ (botapi.max.ru и platform-api.max.ru →
 * isAllowedProviderHost = false), а оба текста пака советовали смену хоста как ОДНО доступное
 * действие. Оператор, поймавший в бою сертификатный отказ, следовал совету и получал ВТОРОЙ отказ
 * другого рода — без единой подсказки, что делать дальше. Цена — потерянное время ровно в аварии.
 *
 * Ось меряет ОБА текста разом: и тот, что печатается при включении канала, и тот, что человек
 * видит в момент сертификатного отказа. Лечение одного из двух оставило бы второй тупик живым.
 */
describe('совет «смените хост» называет ОБА действия, а не одно (№142)', () => {
  it('🔴 предупреждение при включении канала называет перечень и код-ревью', () => {
    // МУТАНТ (красное-до): убрать врезку про перечень — ось краснеет.
    const t = maxTrustRootWarning();
    expect(t).toContain('RF_ALLOWED_PROVIDER_HOSTS');
    expect(t).toContain('код-ревью');
    expect(t).toContain('НЕ ПУСКАЕТ'); // замер назван, а не обещание
  });

  it('🔴 сертификатный отказ адаптера — тоже (человек видит его ИМЕННО в момент смены хоста)', async () => {
    const { MaxBotAdapter } = await import('./messenger/max-bot.adapter');
    const real = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.reject(
        Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('boom'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
        }),
      );
    try {
      const err = (await new MaxBotAdapter('токен-боевой-формы-91824577')
        .sendMessage({ chatId: '1', text: 'x' })
        .catch((e: unknown) => e)) as Error;
      expect(err.message).toContain('RF_ALLOWED_PROVIDER_HOSTS');
      expect(err.message).toContain('ВТОРЫМ отказом');
      expect(err.message).toContain('НЕ ПУСКАЕТ');
    } finally {
      globalThis.fetch = real;
    }
  });

  it('и замер, на который оба текста ссылаются, ВЕРЕН: дверь эти хосты действительно не пускает', async () => {
    // Обратный полюс: без него оба текста могли бы утверждать «не пускает» про хосты, которые
    // дверь пускает, — и совет снова стал бы ложным, только в другую сторону.
    const { isAllowedProviderHost } = await import('../../config/env.validation');
    expect(isAllowedProviderHost('botapi.max.ru')).toBe(false);
    expect(isAllowedProviderHost('platform-api.max.ru')).toBe(false);
    expect(isAllowedProviderHost(MAX_API_HOST)).toBe(true);
  });
});
