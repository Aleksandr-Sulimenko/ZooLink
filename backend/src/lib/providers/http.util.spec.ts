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
    ['односегментное имя (compose)', 'http://mock-sms:8080/x'],
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
