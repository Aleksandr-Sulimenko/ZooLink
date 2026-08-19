import { fetchJson } from './http.util';
import { ProviderError } from './provider-error';
import { RF_ALLOWED_PROVIDER_HOSTS } from '../../config/env.validation';

/**
 * ИСХОДЯЩИЙ ПЕРИМЕТР (ADR-0017, 13.08.2026). Оси стоят на ЕДИНСТВЕННОЙ двери наружу.
 * Замер ДО правки: `https://evil.example.com`, `https://sms.ru.evil.com` и `http://api.telegram.org`
 * уходили В СЕТЬ — отказ приходил лишь транспортный, а телеграм успевал подключиться. То есть
 * утечку ограничивал не мы, а то, отвечает ли чужой сервер.
 *
 * `fetch` подменён: ось обязана доказать, что запрос НЕ БЫЛ СДЕЛАН, — а это видно только по тому,
 * позвали ли `fetch` вообще. Проверять «упало с ошибкой» недостаточно: упасть можно и ПОСЛЕ отправки.
 */
describe('исходящий периметр в двери fetchJson', () => {
  const real = globalThis.fetch;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (input: RequestInfo | URL) => {
      // Разбираем ВСЕ три формы явно: `String(Request)` дал бы «[object Object]», и ось «до сети не
      // дошло» проверяла бы мусор вместо адреса — прибор лгал бы о том, что измеряет.
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(u);
      return Promise.resolve(
        new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    };
  });
  afterEach(() => {
    globalThis.fetch = real;
  });

  const refuses = async (url: string) => {
    await expect(fetchJson('проба', url)).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0); // ← главное: до сети НЕ дошло
  };

  it.each([
    ['зарубежный хост', 'https://evil.example.com/steal'],
    ['похожий на наш (суффиксная подмена)', 'https://sms.ru.evil.com/x'],
    ['подделка под MAX', 'https://platform-api2.max.ru.evil.com/messages'],
    ['портал регистрации MAX, а не API', 'https://business.max.ru/settings'],
    ['api.telegram.org', 'http://api.telegram.org/x'],
    ['другой .ru без код-ревью', 'https://api.sberbank.ru/x'],
    ['схема file://', 'file:///etc/passwd'],
    ['схема ftp://', 'ftp://sms.ru/x'],
    ['не разбирается как URL', 'не-урл'],
    ['userinfo-трюк', 'https://sms.ru@evil.example.com/x'],
    // Приклейка СЛЕВА: `evilsms.ru` / `notplatform-api2.max.ru` — регистрируемые кем угодно домены,
    // и БЕЗ ведущей точки в `.${h}` они прошли бы как «поддомен». Мутант снятия точки должен краснеть.
    ['приклейка слева к sms.ru', 'https://evilsms.ru/x'],
    ['приклейка слева к MAX', 'https://notplatform-api2.max.ru/messages'],
    // IMDS облака: 169.254.169.254 выдаёт IAM-токены инстанса — link-local закрыт целиком (ADR-0017).
    ['метаданные облака (IMDS)', 'http://169.254.169.254/latest/meta-data/'],
    // HTTPS-ONLY для публичных: у СМС/геокодера ключ в адресной строке → по http ушёл бы открытым.
    ['http на публичный хост (ключ ушёл бы открытым)', 'http://sms.ru/sms/send?api_id=x'],
  ])('отказывает ДО запроса: %s', async (_name, url) => {
    await refuses(url);
  });

  it.each([
    ['sms.ru', 'https://sms.ru/sms/send?api_id=x'],
    ['api.unisender.com', 'https://api.unisender.com/ru/api/sendEmail'],
    ['geocode-maps.yandex.ru', 'https://geocode-maps.yandex.ru/1.x/?apikey=x'],
    ['MAX Bot API (канал сообщений)', 'https://platform-api2.max.ru/messages'],
    ['поддомен разрешённого', 'https://gate.sms.ru/x'],
    ['localhost (мок/стенд)', 'http://localhost:9999/x'],
    ['RFC1918', 'http://10.0.0.5/x'],
  ])('НЕ отнимает способность: %s', async (_name, url) => {
    await expect(fetchJson('проба', url)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it('в сообщении об отказе НЕТ самого URL — у части провайдеров ключ живёт в адресной строке', async () => {
    const secret = 'sup3rs3cret';
    const err = (await fetchJson<unknown>('проба', `https://evil.example.com/x?api_id=${secret}`).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(String(err.message)).not.toContain(secret);
    expect(String(err.message)).not.toContain('evil.example.com/x');
    expect(String(err.message)).toContain('evil.example.com'); // хост назвать НАДО — иначе не починить
  });

  it('перечень в сообщении берётся из константы, а не переписан руками', async () => {
    const err = (await fetchJson<unknown>('проба', 'https://evil.example.com/x').catch(
      (e: unknown) => e,
    )) as ProviderError;
    for (const h of RF_ALLOWED_PROVIDER_HOSTS) expect(String(err.message)).toContain(h);
  });
});

/**
 * РЕДИРЕКТ — ЖИВОЙ LOOPBACK, БЕЗ ВНЕШНЕЙ СЕТИ. Два http-сервера на 127.0.0.1: A отвечает 3xx на B.
 * Дверь стережёт ТОЛЬКО первый хоп; без `redirect:'error'` fetch пошёл бы по `Location` на B (а на
 * 307 унёс бы ТЕЛО — ключ/код) — на хост, которого дверь не видела. Замер ДО правки (undici по
 * умолчанию `follow`) уводил запрос; здесь доказываем, что второй сервер НЕ получает НИЧЕГО.
 * Этот блок НЕ подменяет `fetch` (в отличие от верхнего) — только так виден настоящий редирект.
 */
describe('дверь и редирект (живой loopback)', () => {
  let a: import('node:http').Server;
  let b: import('node:http').Server;
  let aUrl: string;
  let bHits: { method: string; body: string }[];

  const listen = (s: import('node:http').Server): Promise<number> =>
    new Promise((res) =>
      s.listen(0, '127.0.0.1', () => res((s.address() as { port: number }).port)),
    );

  beforeAll(async () => {
    const { createServer } = await import('node:http');
    b = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        bHits.push({ method: req.method ?? '', body });
        res.end('{"ok":true}');
      });
    });
    const bp = await listen(b);
    a = createServer((req, res) => {
      res.statusCode = req.url?.includes('307') ? 307 : 302;
      res.setHeader('location', `http://127.0.0.1:${bp}/landed`);
      res.end();
    });
    const ap = await listen(a);
    aUrl = `http://127.0.0.1:${ap}`;
  });
  afterAll(() => {
    a.close();
    b.close();
  });
  beforeEach(() => {
    bHits = [];
  });

  it('302 от разрешённого хоста НЕ уходит на второй хоп', async () => {
    await expect(fetchJson('проба', `${aUrl}/302`)).rejects.toBeInstanceOf(ProviderError);
    expect(bHits).toHaveLength(0); // второй сервер не тронут — дверь не пустила дальше
  });

  it('307 НЕ переотправляет тело (ключ/код) на второй хоп', async () => {
    await expect(
      fetchJson('проба', `${aUrl}/307`, { method: 'POST', body: 'api_key=СЕКРЕТ&text=код-123456' }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(bHits).toHaveLength(0);
  });
});

/**
 * ОДНОСЕГМЕНТНОЕ ИМЯ ПЕРЕЕХАЛО ИЗ «БЕЗУСЛОВНО МОЖНО» В «МОЖНО ПО ЯВНОМУ ФЛАГУ» — и это НЕ
 * подгонка свода под новый код, а запись состоявшегося решения, поэтому оси стало ДВЕ, а не ноль.
 *
 * Почему прежняя ось («НЕ отнимает способность: односегментное имя») перестала быть верной:
 * разрешение такого имени отдано `resolv.conf` МАШИНЫ, а не нашему перечню — при заданном
 * search-домене `http://evilhost/x` уходит НАРУЖУ (находка №9 ре-гейта). Держатель 17.08 отверг
 * и «отвергать всегда» (отняло бы стенды, закон храповика), и «строго только в проде» (fail-open
 * по умолчанию: нет переменной — периметр открыт). Принято: СТРОГО ВСЕГДА + явный отдельный флаг.
 * Способность сохранена целиком, но включается ОСОЗНАННО.
 */
describe('исходящий периметр: односегментное имя — способность за явным флагом (находка №9)', () => {
  const savedFlag = process.env.ALLOW_LOCAL_STAND_HOSTS;
  const realFetch = globalThis.fetch;
  let hits: string[];

  beforeEach(() => {
    hits = [];
    globalThis.fetch = (input: RequestInfo | URL) => {
      hits.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedFlag === undefined) delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    else process.env.ALLOW_LOCAL_STAND_HOSTS = savedFlag;
  });

  it('БЕЗ флага стенд-имя отвергается ДО запроса (fail-closed, до сети не дошло)', async () => {
    delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    await expect(fetchJson('проба', 'http://mock-sms:8080/x')).rejects.toBeInstanceOf(ProviderError);
    expect(hits).toHaveLength(0);
  });

  it('С флагом способность стенда СОХРАНЕНА полностью', async () => {
    process.env.ALLOW_LOCAL_STAND_HOSTS = '1';
    await expect(fetchJson('проба', 'http://mock-sms:8080/x')).resolves.toEqual({ ok: true });
    expect(hits).toHaveLength(1);
  });
});

/**
 * ПОТОЛОК ОБЪЁМА ОТВЕТА — ОСИ, КОТОРЫХ НЕ БЫЛО (находки круга 2: reviewer-qa K-3, backend У-4,
 * security БЛОКЕР-4 — три лейна независимо).
 *
 * Почему это отдельный урок, а не просто «дописали тесты»: батарея мутаций показала, что снятие
 * потолка (умножить константу на 8192), выключение счёта фактических байт и ВОЗВРАТ чужого тела в
 * журнал проходили свод ЗЕЛЁНЫМ — 235 из 235. То есть чинился КРИТ, роняющий весь процесс Node
 * (замер: тело ~3 ГиБ → RSS 6,2 ГБ и core dumped), и после починки его не стерегло НИЧТО.
 * Утверждение без прибора (ADR-0026), причём на пути УСПЕХА каждого запроса.
 */
describe('исходящий периметр: потолок объёма ответа (круг 2)', () => {
  const realFetch = globalThis.fetch;
  const CAP = 1024 * 1024;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const respond = (body: BodyInit, headers: Record<string, string>) => {
    globalThis.fetch = () => Promise.resolve(new Response(body, { status: 200, headers }));
  };

  it('ОБЪЯВЛЕННАЯ длина больше потолка — отказ ДО чтения тела', async () => {
    respond('{}', {
      'content-type': 'application/json',
      'content-length': String(CAP * 64),
    });
    const err = (await fetchJson('проба', 'https://sms.ru/x').catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(String(err.message)).toContain('потолк');
  });

  it('БЕЗ content-length: фактическое превышение рвёт чтение (заголовку верить нельзя)', async () => {
    // Поток, который льёт больше потолка кусками — форма, в которой объявленная длина отсутствует
    // вовсе (chunked). Именно на ней таймаут не спасает: он ограничивает ВРЕМЯ, а не ОБЪЁМ.
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > CAP * 4) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    respond(stream, { 'content-type': 'application/json' });
    const err = (await fetchJson('проба', 'https://sms.ru/x').catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(String(err.message)).toContain('превысил');
  });

  it('превышение потолка сохраняет РОД response, а не переворачивается в network', async () => {
    // Ось на РОД, а не на подстроку: круг 3 замерил, что удаление проброса ProviderError изнутри
    // чтения тела проходит 256/256 ЗЕЛЁНЫМ, потому что все оси потолка проверяли ПОДСТРОКУ, а она
    // при переоборачивании СОХРАНЯЕТСЯ. Перевёрнутый род говорит политике повторов «повтори» о
    // детерминированном отказе — усиление нагрузки на вендора ровно тогда, когда ответы велики.
    respond('{}', {
      'content-type': 'application/json',
      'content-length': String(CAP * 64),
    });
    const err = (await fetchJson('проба', 'https://sms.ru/x').catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('response');
  });

  it('ответ ПОД потолком проходит целиком — способность не отнята', async () => {
    const payload = JSON.stringify({ ok: true, filler: 'я'.repeat(1000) });
    respond(payload, { 'content-type': 'application/json' });
    await expect(fetchJson('проба', 'https://sms.ru/x')).resolves.toMatchObject({ ok: true });
  });

  it('сбой ВО ВРЕМЯ чтения тела приходит ProviderError, а не сырой ошибкой', async () => {
    // Класс, найденный двумя лейнами: чтение стояло ВНЕ try, и обрыв в середине тела уходил наружу
    // сырым TypeError — мимо 503, в 500 со стеком в журнал.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([123]));
        controller.error(new TypeError('terminated'));
      },
    });
    respond(stream, { 'content-type': 'application/json' });
    const err = (await fetchJson('проба', 'https://sms.ru/x').catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('network');
  });

  it('сбой ПОСЛЕ приёма помечен «мог дойти» — повтор способен создать дубль', async () => {
    // Ось на ПРИЗНАК, а не на текст: политика повторов будет ветвиться по полю, и оно обязано
    // отличать «не дошло» от «мог дойти». Замерено кругом 3: без различения повтор доводил
    // счётчик обработанных площадкой запросов с 1 до 2 — у живого человека появлялся ДУБЛЬ.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([123]));
        c.error(new TypeError('terminated'));
      },
    });
    globalThis.fetch = () =>
      Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }));
    const err = (await fetchJson('проба', 'https://sms.ru/x').catch((e: unknown) => e)) as ProviderError;
    expect(err.mayHaveArrived).toBe(true);
  });

  it('отказ ДО приёма (хост вне перечня) НЕ помечен «мог дойти»', async () => {
    const err = (await fetchJson('проба', 'https://evil.example.com/x').catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.mayHaveArrived).toBe(false);
  });

  it('тело чужого ответа НЕ попадает в сообщение об отказе (правило разглашения)', async () => {
    const evil = 'api_id=SUPERSECRET\n2026-08-17 FAKE LOG LINE';
    globalThis.fetch = () =>
      Promise.resolve(new Response(evil, { status: 500, headers: { 'content-type': 'text/plain' } }));
    const err = (await fetchJson('проба', 'https://sms.ru/x').catch((e: unknown) => e)) as ProviderError;
    expect(String(err.message)).not.toContain('SUPERSECRET');
    expect(String(err.message)).not.toContain('FAKE LOG LINE');
    expect(String(err.message)).toContain('тело не логируется');
  });
});

/**
 * ОТМЕНА ТЕЛА НА ПУТИ ОТКАЗА — ОСЬ, КОТОРОЙ НЕ БЫЛО (найдено МОЕЙ ЖЕ мутацией 17.08, до круга 4).
 *
 * Круг 3 замерил, что непрочитанное тело держит соединение БЕССРОЧНО: 300 отказов дали дескрипторы
 * 20 → 620, и после принудительной сборки мусора те же 620. Починка (отмена тела перед броском)
 * была сделана — и не стереглась ничем: снятие обеих отмен проходило 290/290 ЗЕЛЁНЫМ.
 * Ось проверяет ФАКТ отмены у источника потока, а не подстроку сообщения.
 */
describe('исходящий периметр: тело отменяется перед броском (круг 3, ось добавлена мутацией)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const streamThatWatchesCancel = () => {
    const state = { cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"a":1}'));
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { state, body };
  };

  it('не-2xx: тело ОТМЕНЕНО, а не брошено непрочитанным', async () => {
    const { state, body } = streamThatWatchesCancel();
    globalThis.fetch = () =>
      Promise.resolve(new Response(body, { status: 500, headers: { 'content-type': 'text/plain' } }));
    await fetchJson('проба', 'https://sms.ru/x').catch(() => undefined);
    expect(state.cancelled).toBe(true);
  });

  it('объявленный гигант: тело ОТМЕНЕНО до чтения', async () => {
    const { state, body } = streamThatWatchesCancel();
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 * 64) },
        }),
      );
    await fetchJson('проба', 'https://sms.ru/x').catch(() => undefined);
    expect(state.cancelled).toBe(true);
  });
});
