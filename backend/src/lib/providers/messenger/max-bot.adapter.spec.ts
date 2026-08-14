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

  it('СЕРТИФИКАТНЫЙ отказ назван ПРИЧИНОЙ, а не «сетью» (домен подписан НУЦ Минцифры)', async () => {
    reply = () => Promise.reject(new Error('unable to verify the first certificate'));
    const err = (await new MaxBotAdapter(TOKEN)
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('config'); // не 'network': сеть тут ни при чём
    expect(err.message).toContain('НУЦ Минцифры');
    expect(err.message).toContain('NODE_EXTRA_CA_CERTS');
    expect(err.message).not.toContain(TOKEN);
  });

  it('обычный сетевой отказ ОСТАЁТСЯ сетевым — диагноз про сертификат не навязывается', async () => {
    reply = () => Promise.reject(new Error('ECONNREFUSED'));
    const err = (await new MaxBotAdapter(TOKEN)
      .sendMessage({ chatId: '1', text: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain('НУЦ');
  });

  it('заглушка не печатает текст сообщения в журнал', async () => {
    const res = await new StubMessengerProvider().sendMessage({ chatId: '7', text: 'код 999999' });
    expect(res).toEqual({ accepted: true, providerMessageId: null });
    expect(seen).toHaveLength(0);
  });
});
