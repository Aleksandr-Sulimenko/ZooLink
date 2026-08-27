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
      if (req.url?.includes('slow')) {
        // МЕДЛЕННЫЙ ОТВЕТ — стенд для оси на отмену вызывающим: без него сервер отвечал бы
        // редиректом мгновенно, и ось проверяла бы совсем не то, что названа проверять.
        setTimeout(() => res.end('{"ok":true}'), 2000).unref();
        return;
      }
      res.statusCode = req.url?.includes('307') ? 307 : 302;
      res.setHeader('location', `http://127.0.0.1:${bp}/landed`);
      res.end();
    });
    const ap = await listen(a);
    aUrl = `http://127.0.0.1:${ap}`;
  });
  afterAll(async () => {
    // ДОЖДАННОЕ закрытие + сброс keep-alive (находка №169): недожданный close() не закрывает живые
    // соединения undici, серверы оставались с сокетами, и jest ДОБИВАЛ рабочий процесс («force
    // exited») при любом соседе по прогону. Свидетель, чей процесс добивает рантайм, годен ровно
    // до первого случая, когда добивание случится раньше выгрузки отчёта.
    a.closeAllConnections();
    b.closeAllConnections();
    await new Promise<void>((r) => a.close(() => r()));
    await new Promise<void>((r) => b.close(() => r()));
  });
  beforeEach(() => {
    bHits = [];
  });

  it('302 от разрешённого хоста НЕ уходит на второй хоп', async () => {
    await expect(fetchJson('проба', `${aUrl}/302`)).rejects.toBeInstanceOf(ProviderError);
    expect(bHits).toHaveLength(0); // второй сервер не тронут — дверь не пустила дальше
  });

  it('ВЫЗЫВАЮЩИЙ НЕ МОЖЕТ ПЕРЕОПРЕДЕЛИТЬ redirect (порядок полей запаян осью, а не комментарием)', async () => {
    // Мутант «перенести redirect:'error' ПЕРЕД ...init» оставался зелёным на всех 26 осях: свойство
    // держалось комментарием. Здесь вызывающий ЯВНО просит follow — и всё равно не проходит.
    await expect(
      fetchJson('проба', `${aUrl}/302`, { redirect: 'follow' }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(bHits).toHaveLength(0);
  });

  it('редирект отличим от обрыва связи: постоянный отказ, назван словами, помечен «мог дойти»', async () => {
    const err = (await fetchJson('проба', `${aUrl}/302`).catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('config'); // не 'network': чинится код-ревью, а не повтором
    expect(err.message).toContain('ПЕРЕНАПРАВЛЕНИЕМ');
    expect(err.message).toContain('ПОСТОЯННЫЙ');
    expect(err.mayHaveArrived).toBe(true); // 3xx — это ОТВЕТ: площадка запрос приняла
  });

  it('сигнал ВЫЗЫВАЮЩЕГО не съедается нашим таймаутом (отмена работает)', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const err = (await fetchJson('проба', `${aUrl}/slow`, { signal: ac.signal }).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('network'); // отменено, а не «дожили до ответа»
  });

  it('КОД РАНТАЙМА НАЗВАН В САМОМ СООБЩЕНИИ, а не только в поле (три адаптера из четырёх его не читали)', async () => {
    // 127.0.0.1 с заведомо закрытым портом: реальный ECONNREFUSED, а не подделка ошибки.
    // Порт берётся ЗАНЯТЫМ И ТУТ ЖЕ ОСВОБОЖДЁННЫМ, а не выдуманным: `:1` даёт у undici «bad port»
    // БЕЗ кода рантайма — то есть ось проверяла бы не тот отказ, что названа (поймано при написании).
    const { createServer } = await import('node:http');
    const tmp = createServer();
    const port = await new Promise<number>((r) =>
      tmp.listen(0, '127.0.0.1', () => r((tmp.address() as { port: number }).port)),
    );
    await new Promise<void>((r) => tmp.close(() => r()));
    const err = (await fetchJson('проба', `http://127.0.0.1:${port}/x`).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.kind).toBe('network');
    expect(err.code).toBe('ECONNREFUSED');
    expect(err.message).toContain('ECONNREFUSED'); // человек видит причину, а не «fetch failed»
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

  it('ОТКАЗ НАЗЫВАЕТ ПУТЬ НАРУЖУ: стенд по http видит имя флага, а не «публичный хост»', async () => {
    delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    // Проверка схемы стоит ВЫШЕ проверки перечня, поэтому это ЕДИНСТВЕННОЕ сообщение, которое
    // стенд когда-либо увидит — и до круга 3 именно в нём флаг назван НЕ БЫЛ (находка круга 3).
    const err = await fetchJson('проба', 'http://mock-sms:8080/x').catch((e: unknown) => e);
    const текст = (err as ProviderError).message;
    expect(текст).toContain('ALLOW_LOCAL_STAND_HOSTS=1');
    expect(текст).toContain('выключен'); // состояние флага названо, а не оставлено гадать
    expect(текст).not.toContain('публичный хост'); // стенд — не публичный хост
    expect(текст).not.toMatch(/http — лишь для .*локального имени/); // обещание, опровергнутое тут же
  });

  it('*.localhost: отказ говорит, что флаг ЕГО НЕ ОТКРЫВАЕТ — иначе оператор идёт по ложному следу', async () => {
    process.env.ALLOW_LOCAL_STAND_HOSTS = '1'; // флаг ВКЛЮЧЁН — и всё равно закрыто
    const err = await fetchJson('проба', 'http://evil.localhost/x').catch((e: unknown) => e);
    const текст = (err as ProviderError).message;
    expect(текст).toContain('*.localhost');
    expect(текст).toMatch(/закрыты ВСЕГДА|флаг их не открывает/);
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

/**
 * «МОГ ДОЙТИ» НА ВСЕХ ЧЕТЫРЁХ ВЕТКАХ ЗА ОДНИМ РУБЕЖОМ (круг 4, два лейна независимо).
 *
 * Признак ставился на ОДНОЙ ветке из четырёх, а умолчание `false` читается как «повтор безопасен».
 * Во всех четырёх случаях заголовки УЖЕ пришли — площадка запрос ПРИНЯЛА, — и повтор дал бы ДУБЛЬ
 * живому человеку. Ось на КАЖДУЮ ветку, а не на одну: класс ловится только полным перебором.
 */
describe('исходящий периметр: «мог дойти» на всех ветках после ответа (круг 4)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const reply = (body: BodyInit, init: ResponseInit) => {
    globalThis.fetch = () => Promise.resolve(new Response(body, init));
  };
  const err = async () =>
    (await fetchJson('проба', 'https://sms.ru/x').catch((e: unknown) => e)) as ProviderError;

  it('не-2xx — мог дойти', async () => {
    reply('нет', { status: 500, headers: { 'content-type': 'text/plain' } });
    expect((await err()).mayHaveArrived).toBe(true);
  });

  it('невалидный JSON — мог дойти', async () => {
    reply('не json', { status: 200, headers: { 'content-type': 'application/json' } });
    expect((await err()).mayHaveArrived).toBe(true);
  });

  it('объявленное превышение потолка — мог дойти', async () => {
    reply('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 * 64) },
    });
    expect((await err()).mayHaveArrived).toBe(true);
  });

  it('фактическое превышение потолка — мог дойти', async () => {
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > 1024 * 1024 * 4) return c.close();
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    reply(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    expect((await err()).mayHaveArrived).toBe(true);
  });

  it('отказ ДО отправки (хост вне перечня) — НЕ мог дойти', async () => {
    const e = (await fetchJson('проба', 'https://evil.example.com/x').catch(
      (x: unknown) => x,
    )) as ProviderError;
    expect(e.mayHaveArrived).toBe(false);
  });
});
