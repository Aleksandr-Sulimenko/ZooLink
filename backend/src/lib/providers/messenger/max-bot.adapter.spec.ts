import { Logger } from '@nestjs/common';
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
    expect(res).toEqual({ accepted: true, providerMessageId: 'mid-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain('platform-api2.max.ru');
    expect(seen[0].url).toContain('chat_id=385842011');
  });

  it('ТОКЕН НЕ ПОПАДАЕТ В URL — он идёт заголовком (у СМС и геокодера ключ в адресе, здесь так не надо)', async () => {
    await new MaxBotAdapter(TOKEN).sendMessage({ chatId: '1', text: 'x' });
    expect(seen[0].url).not.toContain(TOKEN);
    expect(String((seen[0].init?.headers as Record<string, string>).Authorization)).toContain(TOKEN);
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
    expect(res).toEqual({ accepted: true, providerMessageId: null });
    expect(seen).toHaveLength(0);
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
    expect(res.accepted).toBe(false);
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
    expect(res.accepted).toBe(false);
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
