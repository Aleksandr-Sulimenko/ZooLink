import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { MAX_API_HOST, RF_ALLOWED_PROVIDER_HOSTS } from '../../../config/env.validation';
import { MaxBotAdapter } from './max-bot.adapter';
import { StubMessengerProvider } from './stub-messenger.adapter';
import { ProviderError } from '../provider-error';

/**
 * Оси канала MAX. `fetch` подменён: живой вызов из свода запрещён (проба не ходит в сеть), да и
 * доказать «секрет не уехал в URL» можно только увидев сам запрос.
 */
describe('MaxBotAdapter', () => {
  const real = globalThis.fetch;
  let seen: { url: string; init: RequestInit | undefined }[];
  let reply: () => Promise<Response>;

  beforeEach(() => {
    seen = [];
    reply = () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: { body: { mid: 'mid-1' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url: u, init });
      return reply();
    };
  });
  afterEach(() => {
    globalThis.fetch = real;
  });

  const TOKEN = 'секретный-токен-бота-42';

  it('отправляет на разрешённый хост и возвращает идентификатор сообщения', async () => {
    const res = await new MaxBotAdapter(TOKEN).sendMessage({ chatId: '385842011', text: 'привет' });
    expect(res).toEqual({ outcome: 'accepted', providerMessageId: 'mid-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain(MAX_API_HOST);
    expect(seen[0].url).toContain('chat_id=385842011');
  });

  it('ТОКЕН НЕ ПОПАДАЕТ В URL — он идёт заголовком (у СМС и геокодера ключ в адресе, здесь так не надо)', async () => {
    await new MaxBotAdapter(TOKEN).sendMessage({ chatId: '1', text: 'x' });
    expect(seen[0].url).not.toContain(TOKEN);
    // ТОЧНАЯ форма, а не toContain (находка №166): toContain истинно и для «Bearer ТОКЕН», и для
    // голого «ТОКЕН» — мутант М8 (снятие Bearer) проходил зелёным, форма единственного секрета
    // канала не держалась ни в одну сторону. Прижата ТЕКУЩАЯ форма; №58 спорит, ВЕРНА ли она для
    // нашего хоста — когда живой вызов ответит, эту строку меняют ОСОЗНАННО, вместе с адаптером.
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('текст сообщения уходит в ТЕЛЕ, а не в адресе (в тексте бывает код)', async () => {
    await new MaxBotAdapter(TOKEN).sendMessage({ chatId: '1', text: 'код 123456' });
    expect(seen[0].url).not.toContain('123456');
    // Тело у нас всегда строка (JSON.stringify в адаптере) — приводим ЯВНО, а не через String():
    // String(объект) дал бы «[object Object]», и ось проверяла бы мусор вместо содержимого.
    expect(typeof seen[0].init?.body).toBe('string');
    expect(seen[0].init?.body as string).toContain('код 123456');
  });

  it('chat_id экранируется — чужой параметр в идентификатор не подставить', async () => {
    await new MaxBotAdapter(TOKEN).sendMessage({ chatId: '1&admin=true', text: 'x' });
    expect(seen[0].url).not.toContain('&admin=true');
    expect(seen[0].url).toContain('chat_id=1%26admin%3Dtrue');
  });

  // РЕАЛЬНАЯ ФОРМА ОШИБКИ undici (замерено на живом рантайме 14.08.2026, НЕ выдумано): верхняя
  // ошибка — TypeError('fetch failed') БЕЗ кода, а настоящая причина живёт в `.cause` как Error с
  // `.code`. Прежний свод бросал ГОЛЫЙ Error с текстом «unable to verify…» — форму, которой undici не
  // производит НИКОГДА, и потому диагностика по подстроке `message` проходила зелёной, будучи мёртвой.
  const undiciFail = (code: string, message = 'boom') =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(message), { code }),
    });

  it.each([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
  ])('«нет якоря доверия» (%s) → диагноз про НУЦ Минцифры и российский корень', async (code) => {
    reply = () => Promise.reject(undiciFail(code));
    const err = (await new MaxBotAdapter(TOKEN)
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('config'); // не 'network': сеть тут ни при чём
    expect(err.message).toContain('НУЦ Минцифры');
    // ОСЬ НА ПОЗИЦИЮ, А НЕ НА СЛОВО. Круг 3 замерил: мутация «перевернуть совет с ЗАПРЕТА на
    // ПРЕДПИСАНИЕ, сохранив имя переменной» проходила 21/21 зелёным, потому что ось пришпиливала
    // подстроку. Ось, проверяющая слово, стережёт словарь, а не суждение.
    expect(err.message).toContain('NODE_EXTRA_CA_CERTS');
    expect(err.message).toContain('узким бандлом');
    expect(err.message).toMatch(/а не\s+NODE_EXTRA_CA_CERTS/);
    expect(err.message).toContain('сверьте издателя');
    expect(err.message).toContain(code); // код рантайма назван — чинить, не гадать
    expect(err.message).not.toContain(TOKEN);
  });

  it.each(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'])(
    'сертификатный отказ ДРУГОГО рода (%s) — БЕЗ совета досыпать доверия (может быть подмена)',
    async (code) => {
      reply = () => Promise.reject(undiciFail(code));
      const err = (await new MaxBotAdapter(TOKEN)
        .sendMessage({ chatId: '1', text: 'x' })
        .catch((e: unknown) => e)) as ProviderError;
      expect(err.kind).toBe('config');
      expect(err.message).toContain(code);
      // НЕСУЩЕЕ: истёкший/несовпавший сертификат может означать MITM — совет «добавь корень» здесь
      // ослабил бы доверие в момент атаки на доверие. Его быть НЕ ДОЛЖНО.
      expect(err.message).not.toContain('NODE_EXTRA_CA_CERTS');
      expect(err.message).not.toContain('russian_trusted_ca');
    },
  );

  it('обычный сетевой отказ ОСТАЁТСЯ сетевым — диагноз про сертификат не навязывается', async () => {
    reply = () => Promise.reject(undiciFail('ECONNREFUSED', 'connect ECONNREFUSED'));
    const err = (await new MaxBotAdapter(TOKEN)
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain('НУЦ');
    expect(err.code).toBe('ECONNREFUSED'); // код всё равно извлечён — на будущую политику повторов
  });

  it('заглушка не печатает текст сообщения в журнал', async () => {
    const res = await new StubMessengerProvider().sendMessage({ chatId: '7', text: 'код 999999' });
    // ЗАГЛУШКА НЕ ГОВОРИТ «ПРИНЯТО» (находка №131): она не отправляла ничего, и исход у неё свой.
    expect(res).toEqual({ outcome: 'not-sent', providerMessageId: null });
    expect(seen).toHaveLength(0);
  });
  // ── ВТОРОЙ СЛОЙ ПРОТИВ УТЕЧКИ ТОКЕНА (крит круга 5) ──────────────────────────────────────────
  // Первый слой — отказ на старте (env.validation) — закрывает ИЗВЕСТНЫЙ путь: undici эхом
  // возвращает значение заголовка. Здесь стережём СПОСОБНОСТЬ: что бы ни принёс рантайм, секрет
  // не уйдёт в текст ошибки, потому что адаптер им ВЛАДЕЕТ и сверяет ТОЧНЫМ совпадением.
  describe('секрет не выносится в текст ошибки: владелец секрета вырезает свой секрет', () => {
    it('🔴 сообщение рантайма, НЕСУЩЕЕ токен, приходит вызывающему БЕЗ него', async () => {
      const секрет = 'BOEVOY-TOKEN-4f81ac';
      // Рантайм отдаёт ровно то, что undici отдаёт живьём при негодном заголовке — с секретом внутри.
      reply = () => {
        throw new TypeError(`Headers.append: "Bearer ${секрет}" is an invalid header value.`);
      };
      const err = (await new MaxBotAdapter(секрет)
        .sendMessage({ chatId: '1', text: 'x' })
        .catch((e: unknown) => e)) as ProviderError;
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.message).not.toContain(секрет);
      expect(err.message).toContain('<СЕКРЕТ ВЫРЕЗАН: MAX_BOT_TOKEN>');
    });

    it('диагноз НЕ обесценен: всё, кроме секрета, остаётся на месте', async () => {
      const секрет = 'BOEVOY-TOKEN-4f81ac';
      reply = () => {
        throw new TypeError(`Headers.append: "Bearer ${секрет}" is an invalid header value.`);
      };
      const err = (await new MaxBotAdapter(секрет)
        .sendMessage({ chatId: '1', text: 'x' })
        .catch((e: unknown) => e)) as ProviderError;
      expect(err.message).toContain('Headers.append');
      expect(err.message).toContain('is an invalid header value');
      expect(err.provider).toBe('max');
    });

    it('ЧИСТОЕ сообщение не трогается вовсе — вырезание не должно быть шумом', async () => {
      reply = () => {
        throw new TypeError('socket hang up');
      };
      const err = (await new MaxBotAdapter('BOEVOY-TOKEN-4f81ac')
        .sendMessage({ chatId: '1', text: 'x' })
        .catch((e: unknown) => e)) as ProviderError;
      expect(err.message).toContain('socket hang up');
      expect(err.message).not.toContain('ВЫРЕЗАН');
    });

    it('ГРАНИЦА, НАЗВАННАЯ ВСЛУХ: ЧАСТЬ токена точным совпадением НЕ ловится', async () => {
      const секрет = 'BOEVOY-TOKEN-4f81ac';
      reply = () => {
        throw new TypeError('Headers.append: "Bearer BOEVOY-TOKEN" is an invalid header value.');
      };
      const err = (await new MaxBotAdapter(секрет)
        .sendMessage({ chatId: '1', text: 'x' })
        .catch((e: unknown) => e)) as ProviderError;
      // Это НЕ дефект оси, а честно названный предел второго слоя: обрезанный секрет он не увидит.
      // Против такого работает ПЕРВЫЙ слой (негодное значение не доживает до заголовка).
      expect(err.message).toContain('BOEVOY-TOKEN');
      expect(err.message).not.toContain('ВЫРЕЗАН');
    });
  });

});

/**
 * ПРИЁМ СУДИТСЯ ПО ТЕЛУ, А НЕ ПО КОДУ ОТВЕТА (находка №24, крит; лечение 17.08.2026).
 *
 * Оси написаны ПО ЖИВОМУ ЗАМЕРУ соседнего трека, а не по нашей догадке: площадка отвечает
 * HTTP 200 с телом {"success":false,"message":"Invalid chatId: 0"} — то есть код 200 не является
 * свидетельством приёма. Второй свидетель — `mid`: замерено, что при успехе он есть ВСЕГДА.
 * Третья ось стережёт правило разглашения: ни идентификатор чата, ни `mid` в журнал не пишутся
 * (площадка достаёт из `mid` идентификатор чата, значит это второй, неявный экземпляр адресата).
 */
describe('MaxBotAdapter — 200 не значит «принято» (ре-гейт, находка №24)', () => {
  const real = globalThis.fetch;
  let body: unknown;
  beforeEach(() => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
  });
  afterEach(() => {
    globalThis.fetch = real;
  });

  it('200 с success:false — ОТКАЗ, а не «принято»', async () => {
    body = { success: false, message: 'Invalid chatId: 0' };
    await expect(
      new MaxBotAdapter('t').sendMessage({ chatId: '1', text: 'x' }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('200 без mid — accepted:false и предупреждение, а не тихий успех', async () => {
    body = { message: { body: {} } };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const res = await new MaxBotAdapter('t').sendMessage({ chatId: '1', text: 'x' });
    expect(res.outcome).toBe('unconfirmed');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('200 с mid=ПУСТОЙ СТРОКОЙ — не идентификатор: accepted:false, providerMessageId:null (находка №168)', async () => {
    // Соседняя ось меряет только ОТСУТСТВИЕ mid — мутант М9 (снятие `&& rawMid !== ''`) проходил
    // её зелёным, и домен получал accepted:true с providerMessageId:'' — значение, которое не null
    // («идентификатор есть») и не идентификатор. Тот же вред, что у ветки №24: отправлено ≠ не отправлено.
    body = { message: { body: { mid: '' } } };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const res = await new MaxBotAdapter('t').sendMessage({ chatId: '1', text: 'x' });
    expect(res.outcome).toBe('unconfirmed');
    expect(res.providerMessageId).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('в журнал не попадают ни chat_id, ни mid (оба несут адресата)', async () => {
    body = { message: { body: { mid: 'mid.deadbeef' } } };
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    await new MaxBotAdapter('t').sendMessage({ chatId: '385842011', text: 'x' });
    const printed = log.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(printed).not.toContain('385842011');
    expect(printed).not.toContain('mid.deadbeef');
    log.mockRestore();
  });
});

/**
 * СТРАЖИ ЛЕЧЕНИЯ КРУГА 2 (по новому замку прибора: «починена» обязана назвать стража).
 * Каждый из этих случаев измерялся лейнами вручную и до сих пор не был запаян ничем.
 */
describe('MaxBotAdapter — форма чужого тела и молчание заглушки (круг 2)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const respond = (body: string) => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
  };

  it('тело null — ProviderError, а НЕ сырой TypeError (мина лечения №24)', async () => {
    respond('null');
    const err = (await new MaxBotAdapter('t')
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
  });

  it.each(['[]', '"строка"', '42'])('не-объект (%s) — ProviderError, а не чтение полей', async (body) => {
    respond(body);
    const err = (await new MaxBotAdapter('t')
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
  });

  it('mid не-строкой не принимается за идентификатор', async () => {
    respond(JSON.stringify({ message: { body: { mid: 12345 } } }));
    const res = await new MaxBotAdapter('t').sendMessage({ chatId: '1', text: 'x' });
    expect(res.providerMessageId).toBeNull();
    expect(res.outcome).toBe('unconfirmed');
  });

  it('ЗАГЛУШКА не пишет идентификатор получателя в журнал', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await new StubMessengerProvider().sendMessage({ chatId: '385842011', text: 'секретный код 4821' });
    const printed = warn.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(printed).not.toContain('385842011');
    expect(printed).not.toContain('4821');
    warn.mockRestore();
  });
});

/**
 * ТОКЕН БОЕВОЙ ФОРМЫ, А НЕ ОДНОБУКВЕННЫЙ (найдено ЭТИМИ ЖЕ ОСЯМИ 31.08.2026).
 * С токеном `'t'` второй слой защиты секрета вырезал букву «t» ИЗ ЧУЖОГО ТЕКСТА: причина отказа
 * площадки «Invalid chatId» приходила как «Invalid cha<СЕКРЕТ ВЫРЕЗАН>Id». Свойство КОДА, а не
 * свода (схема минимальной длины у MAX_BOT_TOKEN не требует) — заведено находкой; здесь же ось
 * обязана мерить предмет, а не вырожденный вход.
 */
const ТОКЕН_БОЕВОЙ_ФОРМЫ = '9f3a1c-bot-token-91824577';

/**
 * ═══ СТРАЖИ КЛАСТЕРА MAX (находки №124, №125, №129, №130, №131, №132; круг 5) ═══
 *
 * Каждая ось поставлена ПОД конкретную находку и проверена МУТАНТОМ (красное-до): её отказ
 * воспроизводился снятием ровно того куска лечения, ради которого она написана. Зелёное без
 * показанного красного здесь не считается — это правило дома, а не осторожность.
 */
describe('MAX — исход отправки различим, а не булев (№131, №124)', () => {
  const real = globalThis.fetch;
  let body: unknown;
  let вызовов: number;
  beforeEach(() => {
    вызовов = 0;
    globalThis.fetch = () => {
      вызовов += 1;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
  });
  afterEach(() => {
    globalThis.fetch = real;
  });

  it('приём подтверждён (mid есть) → outcome=accepted', async () => {
    body = { message: { body: { mid: 'mid-7' } } };
    const res = await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ).sendMessage({ chatId: '1', text: 'x' });
    expect(res).toEqual({ outcome: 'accepted', providerMessageId: 'mid-7' });
  });

  it('🔴 200 без mid → исход НЕСЁТ СОМНЕНИЕ (unconfirmed), а не «не принято»', async () => {
    // МУТАНТ (красное-до): вернуть `outcome: mid === null ? 'not-sent' : 'accepted'` — ось краснеет.
    // ПОЧЕМУ ЭТО НЕСУЩЕЕ: `not-sent` читается как «повтор безопасен», а запрос СКОРЕЕ ВСЕГО дошёл —
    // именно здесь рождается ДУБЛЬ у живого человека при подключении канала к outbox.
    body = { message: { body: {} } };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const res = await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ).sendMessage({ chatId: '1', text: 'x' });
    expect(res.outcome).toBe('unconfirmed');
    warn.mockRestore();
  });

  it('🔴 ЗАГЛУШКА И БОЕВОЙ АДАПТЕР НЕ МОГУТ ВЕРНУТЬ ОДИН ИСХОД НА РАЗНЫХ ПО СМЫСЛУ СОБЫТИЯХ', async () => {
    // Ровно то, что было сломано: заглушка говорила `accepted:true` («не отправляли вовсе»), а
    // боевой адаптер тем же полем — про ПОДТВЕРЖДЁННЫЙ приём. МУТАНТ: вернуть заглушке 'accepted'.
    body = { message: { body: {} } };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const боевой = await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ).sendMessage({ chatId: '1', text: 'x' });
    const заглушка = await new StubMessengerProvider().sendMessage({ chatId: '1', text: 'x' });
    warn.mockRestore();
    expect(заглушка.outcome).toBe('not-sent');
    expect(боевой.outcome).not.toBe(заглушка.outcome);
    expect(вызовов).toBe(1); // заглушка в сеть не ходила — иначе сравнивали бы не то
  });

  it('🔴 №124: при НЕподтверждённом приёме слов «message sent» в журнале НЕТ', async () => {
    // МУТАНТ (красное-до): вернуть `log(\`MAX message sent (accepted=${mid !== null})\`)` — ось
    // краснеет. Человек ищет в журнале «message sent»; зелёная строка с этими словами закрывает
    // вопрос «ушло?» словом «да», хотя приём не подтверждён.
    body = { message: { body: {} } };
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ).sendMessage({ chatId: '1', text: 'x' });
    const всёНапечатанное = [...log.mock.calls, ...warn.mock.calls]
      .map((c) => String(c[0]))
      .join(' | ');
    expect(всёНапечатанное).not.toContain('message sent');
    // и отрицание сказано ПЕРВЫМ, а не спрятано в скобку в конце
    expect(warn.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('приём НЕ подтверждён');
    log.mockRestore();
    warn.mockRestore();
  });

  it('при ПОДТВЕРЖДЁННОМ приёме строка «message sent» есть — способность не отнята', async () => {
    // ОБРАТНЫЙ ПОЛЮС: без него ось выше зеленела бы и на коде, который не печатает НИЧЕГО никогда.
    body = { message: { body: { mid: 'mid-7' } } };
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ).sendMessage({ chatId: '1', text: 'x' });
    expect(log.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('message sent');
    log.mockRestore();
  });
});

describe('MAX — адресат проверяется у нас, а не у вендора (№132)', () => {
  const real = globalThis.fetch;
  let вызовов: number;
  beforeEach(() => {
    вызовов = 0;
    globalThis.fetch = () => {
      вызовов += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ message: { body: { mid: 'm' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
  });
  afterEach(() => {
    globalThis.fetch = real;
  });

  it.each(['', '   '])(
    '🔴 пустой chatId («%s») НЕ ПОРОЖДАЕТ исходящего вызова',
    async (chatId) => {
      // МУТАНТ (красное-до): снять проверку в начале sendMessage — вызов уходит в сеть адресом
      // `…/messages?chat_id=`, площадка отвечает 200 с success:false, и НАША ошибка вызывающего
      // приходит как отказ ПЛОЩАДКИ (503 клиенту, ложная тревога «MAX лежит» наблюдению).
      const err = (await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ)
        .sendMessage({ chatId, text: 'x' })
        .catch((e: unknown) => e)) as ProviderError;
      expect(вызовов).toBe(0);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe('config'); // ПОСТОЯННЫЙ отказ, не «сеть» и не «вендор»
      expect(err.message).toContain('адресат не пригоден');
      // Единственный случай, где false значит ТОЧНО «не дошло»: запрос не уходил вовсе.
      expect(err.mayHaveArrived).toBe(false);
    },
  );

  it('НЕ ОТНЯЛИ СПОСОБНОСТЬ: обычный chatId по-прежнему уходит в сеть', async () => {
    const res = await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ).sendMessage({ chatId: '385842011', text: 'x' });
    expect(вызовов).toBe(1);
    expect(res.outcome).toBe('accepted');
  });
});

describe('MAX — причина отказа площадки доходит до оператора без адресата (№129, №130)', () => {
  const real = globalThis.fetch;
  let body: string;
  beforeEach(() => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
      );
  });
  afterEach(() => {
    globalThis.fetch = real;
  });
  const отказ = async (): Promise<ProviderError> =>
    (await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ)
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;

  it('🔴 ДВА РАЗНЫХ ОТКАЗА ПЛОЩАДКИ ДАЮТ ДВА РАЗЛИЧИМЫХ ТЕКСТА', async () => {
    // МУТАНТ (красное-до): убрать `причина` из сообщения — оба отказа печатаются одной фразой,
    // истинной для всех причин сразу и потому не сужающей поиск ни на шаг (оператор идёт
    // перевыпускать токен, тогда как в теле лежало «Invalid chatId»).
    body = JSON.stringify({ success: false, message: 'Invalid chatId: 0' });
    const первый = await отказ();
    body = JSON.stringify({ success: false, message: 'Message text is too long' });
    const второй = await отказ();
    expect(первый.message).not.toBe(второй.message);
    expect(первый.message).toContain('Invalid chatId');
    expect(второй.message).toContain('too long');
  });

  it('🔴 АДРЕСАТ НЕ УХОДИТ: цифровые последовательности вырезаны', async () => {
    // МУТАНТ: отдать `data.message` как есть — в текст уедет идентификатор чата, который этот же
    // файл сознательно не пишет в журнал (правило разглашения).
    body = JSON.stringify({ success: false, message: 'Invalid chatId: 385842011' });
    const err = await отказ();
    expect(err.message).not.toContain('385842011');
    expect(err.message).toContain('Invalid chatId: #');
  });

  it('🔴 ЧУЖОЙ ТЕКСТ НЕ ПОДДЕЛЫВАЕТ СТРОКИ ЖУРНАЛА: переводы строк вырезаны', async () => {
    body = JSON.stringify({ success: false, message: 'boom\n2026-08-15 FAKE LOG LINE' });
    const err = await отказ();
    expect(err.message).not.toContain('\n');
    expect(err.message).toContain('FAKE LOG LINE'); // текст сохранён, СТРОКА — одна
  });

  it('чужое тело не диктует размер нашей строки (обрезка по длине)', async () => {
    body = JSON.stringify({ success: false, message: 'A'.repeat(5000) });
    const err = await отказ();
    expect(err.message.length).toBeLessThan(400);
  });

  it('причины нет — так и сказано, а не выдумано', async () => {
    body = JSON.stringify({ success: false });
    const err = await отказ();
    expect(err.message).toContain('причину площадка не назвала');
  });

  it('🔴 №130: ОБА отказа ПОСЛЕ полученного тела помечены «мог дойти» — паритет', async () => {
    // МУТАНТ (красное-до): снять шестой аргумент `true` у броска на success:false — возвращается
    // ровно замеренный перекос круга 5: у битого JSON true, у явного отказа площадки false, хотя
    // у второго свидетельство приёма СИЛЬНЕЕ (площадка разобрала наш chat_id и назвала его).
    body = JSON.stringify({ success: false, message: 'Invalid chatId: 0' });
    const явныйОтказ = await отказ();
    body = 'не json';
    const битоеТело = await отказ();
    expect(явныйОтказ.mayHaveArrived).toBe(true);
    expect(битоеТело.mayHaveArrived).toBe(true);
    expect(явныйОтказ.mayHaveArrived).toBe(битоеТело.mayHaveArrived);
  });

  it('🔴 №130: ответ НЕ-объектом — тоже «мог дойти» (тело пришло целиком)', async () => {
    body = '[]';
    const err = await отказ();
    expect(err.kind).toBe('response');
    expect(err.mayHaveArrived).toBe(true);
  });
});

/**
 * ═══ ХОСТ КАНАЛА ЖИВЁТ В ОДНОМ МЕСТЕ (находка №125) ═══
 *
 * Ось отвечает ровно на то, чем находка ОПРОВЕРГАЕТСЯ: «покажите одно место, правка которого
 * меняет хост во всех девяти». Машинно значимых копий было ДВЕ (перечень двери и ENDPOINT
 * адаптера), и правка одной без другой давала МЁРТВЫЙ КАНАЛ — дверь отказывает раньше, чем
 * адаптер доходит до сети. Тексты (`.env.example`, ADR и его зеркало) машиной не выводятся —
 * поэтому они СВЕРЯЮТСЯ с константой, а не переписываются вручную и молча расходятся.
 */
describe('MAX — адрес выведен из перечня двери, а не скопирован (№125)', () => {
  const real = globalThis.fetch;
  let seenUrl: string;
  beforeEach(() => {
    seenUrl = '';
    globalThis.fetch = (input: RequestInfo | URL) => {
      seenUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        new Response(JSON.stringify({ message: { body: { mid: 'm' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
  });
  afterEach(() => {
    globalThis.fetch = real;
  });

  it('🔴 адрес запроса СЛЕДУЕТ за перечнем двери — второй копии литерала нет', async () => {
    // МУТАНТ (красное-до): вернуть в адаптер литерал `https://platform-api.max.ru/messages` —
    // ось краснеет, потому что дверь такого хоста не знает и адрес перестаёт следовать за ней.
    await new MaxBotAdapter(ТОКЕН_БОЕВОЙ_ФОРМЫ).sendMessage({ chatId: '1', text: 'x' });
    expect(seenUrl.startsWith(`https://${MAX_API_HOST}/messages?`)).toBe(true);
    // и сам выведенный хост ОБЯЗАН быть элементом перечня, а не похожим на него
    expect(RF_ALLOWED_PROVIDER_HOSTS).toContain(MAX_API_HOST);
  });

  it('🔴 перечень содержит РОВНО ОДИН хост MAX — иначе вывод указывал бы на соседа', () => {
    // МУТАНТ: дописать в перечень второй `*.max.ru` — модуль обязан упасть НА ЗАГРУЗКЕ (громко),
    // а не молча выбрать первый попавшийся.
    expect(RF_ALLOWED_PROVIDER_HOSTS.filter((h) => h.endsWith('.max.ru'))).toHaveLength(1);
  });

  it('🔴 ТЕКСТЫ НЕ РАСХОДЯТСЯ С КОНСТАНТОЙ: .env.example и ADR-0008 (EN+RU) называют тот же хост', () => {
    // МУТАНТ (красное-до): сменить хост в перечне, не тронув документы, — ось краснеет и называет
    // ФАЙЛ. Прежде расхождение кода и текста ловилось только чтением глазами, и именно тексты
    // оператор читает ДО кода.
    // src/lib/providers/messenger → … → backend → корень репозитория (пять шагов, а не четыре:
    // четыре приводили в `backend/`, и ось краснела на ИСПРАВНЫХ файлах — поймано прогоном).
    const корень = path.join(__dirname, '..', '..', '..', '..', '..');
    const тексты = [
      '.env.example',
      path.join('docs', '04-decisions', '0008-rf-provider-matrix.md'),
      path.join('docsRU', '04-decisions', '0008-rf-provider-matrix.md'),
    ];
    for (const имя of тексты) {
      const путь = path.join(корень, имя);
      const текст = fs.readFileSync(путь, 'utf8');
      expect(`${имя}: ${текст.includes(MAX_API_HOST)}`).toBe(`${имя}: true`);
    }
  });
});

/**
 * ═══ ДВА ДЕФЕКТА, НАЙДЕННЫЕ ОСЯМИ КЛАСТЕРА ПРИ ИХ ЖЕ НАПИСАНИИ (31.08.2026) ═══
 * Оба — про ВТОРОЙ СЛОЙ ЗАЩИТЫ СЕКРЕТА, и оба нашла не вычитка, а ПРОГОН.
 */
describe('MAX — слой вырезания секрета не портит диагноз (найдено осями №129)', () => {
  const real = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = real;
  });
  const отказПлощадки = (message: string) => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, message }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
  };

  it('🔴 ПРЕФИКС ПРОВАЙДЕРА НЕ УДВАИВАЕТСЯ при пересборке ошибки', async () => {
    // МУТАНТ (красное-до): снять `.replace(\`[${err.provider}] \`, '')` в безСекрета — в журнал
    // возвращается «[max] [max] …». Дефект видимый, а не смысловой, но читатель принимает его
    // за сбой разбора и идёт искать несуществующую поломку.
    const секрет = 'Invalid'; // секрет, совпадающий с куском чужого текста — путь пересборки жив
    отказПлощадки('Invalid chatId: 0');
    const err = (await new MaxBotAdapter(секрет)
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err.message.startsWith('[max] [max]')).toBe(false);
    expect(err.message.split('[max]')).toHaveLength(2); // ровно один префикс
  });
});
