import {
  isAllowedProviderHost,
  isResidentHost,
  RF_ALLOWED_PROVIDER_HOSTS,
} from '../../config/env.validation';
import { extractRuntimeErrorCode, ProviderError } from './provider-error';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * ИСХОДЯЩИЙ ПЕРИМЕТР В ОДНОЙ ТОЧКЕ (ADR-0017, добавлено 13.08.2026 по слову владельца).
 *
 * ЗАЧЕМ. Замок резидентности читает переменные окружения, а адреса провайдеров ЗАШИТЫ В КОД
 * адаптеров — значит гейт не видел их ПО ПОСТРОЕНИЮ, и новый адаптер с зарубежным хостом прошёл бы
 * молча. ЗАМЕРЕНО до правки: `https://evil.example.com/steal`, `https://sms.ru.evil.com/x` и
 * `http://api.telegram.org/x` уходили В СЕТЬ — отказ приходил лишь транспортный, а телеграм успевал
 * подключиться. То есть утечка ограничивалась не нами, а тем, отвечает ли чужой сервер.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В КАЖДОМ АДАПТЕРЕ. Здесь единственный `fetch` во всём `backend/src` (проверено
 * чтением: иных исходящих клиентов нет). Одна точка = виден ВЕСЬ периметр и нечего забыть.
 *
 * FAIL-CLOSED: неразбираемый адрес, не-http(s) схема и любой хост вне перечня — отказ ДО запроса,
 * а не после. Перечень — `RF_ALLOWED_PROVIDER_HOSTS`, тот же, что парсит CI-гейт.
 */
function assertOutboundHostAllowed(provider: string, url: string): void {
  let host: string;
  let scheme: string;
  try {
    const u = new URL(url);
    host = u.hostname;
    scheme = u.protocol;
  } catch {
    throw new ProviderError(
      provider,
      'config',
      'исходящий адрес не разбирается как URL — запрос не отправлен (fail-closed)',
    );
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new ProviderError(
      provider,
      'config',
      `схема «${scheme}» не разрешена для исходящих запросов — запрос не отправлен`,
    );
  }
  // HTTPS-ONLY для публичных провайдеров: у СМС и геокодера ключ живёт в АДРЕСНОЙ СТРОКЕ — по http
  // он ушёл бы по проводу открытым текстом. Открытый http допускаем ТОЛЬКО для заведомо своего
  // (loopback / RFC1918), где ни один байт не покидает машину. Односегментные имена и `*.localhost`
  // сюда БОЛЬШЕ НЕ ВХОДЯТ по умолчанию: их разрешает резолвер МАШИНЫ, а не наш перечень (находка №9
  // и круг 2), и открываются они только явным `ALLOW_LOCAL_STAND_HOSTS`. `isResidentHost(host, [], {allowRfSuffixes:false})`
  // истинно РОВНО для этой «своей» ветки — публичный хост из перечня сюда не попадает.
  // `outbound: true` — та же строгость, что у проверки хоста ниже: ULA и link-local для ДВЕРИ
  // закрыты целиком (IPv6-IMDS живёт в ULA). Без этого флага `http://[fd00:ec2::254]/…` считался
  // бы «заведомо своим» и получал бы отказ с НЕВЕРНОЙ причиной («хост вне перечня» вместо «http
  // на непроверяемый адрес»), а сообщение об отказе — это то, по чему оператор чинит.
  if (
    scheme === 'http:' &&
    !isResidentHost(host, [], { allowRfSuffixes: false, outbound: true })
  ) {
    throw new ProviderError(
      provider,
      'config',
      `http:// на публичный хост «${host}» запрещён (ключ в адресной строке ушёл бы открытым) — ` +
        `запрос не отправлен. Разрешён только https, http — лишь для loopback/RFC1918/локального имени.`,
    );
  }
  if (!isAllowedProviderHost(host)) {
    // Сообщение НЕ содержит самого URL: у части провайдеров ключ живёт в адресной строке
    // (vendor-mandated), и печатать адрес значило бы разгласить секрет в журнале.
    throw new ProviderError(
      provider,
      'config',
      `хост «${host}» НЕ в перечне исходящего периметра (ADR-0017 / ФЗ-152 ст.18 ч.5) — ` +
        `запрос не отправлен. Разрешены: ${(RF_ALLOWED_PROVIDER_HOSTS as readonly string[]).join(', ')} ` +
        `(плюс своё: loopback / RFC1918). Односегментные имена стендов — только при ` +
        `ALLOW_LOCAL_STAND_HOSTS=1. Новый провайдер добавляется код-ревью, а не правкой .env.`,
    );
  }
}

/**
 * Thin wrapper over global `fetch` shared by HTTP adapters. Enforces a hard timeout
 * (AbortSignal) and normalises transport/HTTP failures into {@link ProviderError},
 * so each adapter only deals with the happy-path JSON body. Circuit-breaking and
 * retry policy are deferred to Phase 3 hardening (integrations.md §3).
 */
export async function fetchJson<T>(
  provider: string,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  assertOutboundHostAllowed(provider, url); // ДО запроса: отказ, а не «поймаем по ответу»

  let res: Response;
  try {
    // `redirect: 'error'` СТОИТ ПОСЛЕ `...init` НАМЕРЕННО: вызывающий не может его переопределить.
    // Без него `fetch` идёт по 3xx сам (дефолт `follow`), и проверка хоста ВЫШЕ стережёт лишь ПЕРВЫЙ
    // хоп — 302 от разрешённого вендора увёл бы запрос (а на 307/308 и ТЕЛО с ключом/кодом) на хост,
    // которого дверь не видела. Ни один наш провайдер редиректов не использует, поэтому способность
    // не отнята (закон храповика); понадобится вендору редирект — вход через код-ревью, как новый хост.
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Код рантайма (напр. `DEPTH_ZERO_SELF_SIGNED_CERT`) прячется в цепочке `cause`, а НЕ в `message`
    // (там всегда «fetch failed»). Достаём его явно — иначе диагностика по подстроке `message`
    // промахивается по построению (замерено на живом undici).
    const code = extractRuntimeErrorCode(err);
    throw new ProviderError(provider, 'network', `request failed: ${reason}`, err, code);
  }

  if (!res.ok) {
    // ТЕЛО ЧУЖОГО СЕРВЕРА В ЖУРНАЛ НЕ ПОПАДАЕТ (находка №11 ре-гейта, вес КРИТ по правилу
    // разглашения). Раньше сюда клался `body.slice(0, 200)`, и это ДВА разных вреда сразу:
    //  · эхо провайдера может вернуть НАШ ключ (у sms.ru и геокодера он в адресной строке) — и
    //    тогда секрет ложится в журнал навсегда; `pino.redact` его не поймает, он ходит по ПУТЯМ
    //    объекта, а не по свободному тексту;
    //  · чужой текст с переводами строк ПОДДЕЛЫВАЕТ строки журнала — замерено на ре-гейте: ответ
    //    с `\n2026-08-15 FAKE LOG LINE` лёг в сообщение дословно.
    // Поэтому наружу отдаём только то, что описывает ФОРМУ ответа, а не его содержимое. Само тело
    // при нужде смотрят на стороне провайдера — у нас его нет и быть не должно.
    const declared = res.headers.get('content-length') ?? 'н/д';
    const ctype = (res.headers.get('content-type') ?? 'н/д').split(';')[0];
    // ОТМЕНА ТЕЛА ПЕРЕД БРОСКОМ. Непрочитанное тело держит соединение: круг 3 замерил 200 ответов
    // 500 подряд — 198 НОВЫХ сокетов, а на 300 отказах дескрипторы 20 → 620, и после принудительной
    // сборки мусора ТЕ ЖЕ 620. Это не удержание до GC, а удержание бессрочно, и приходит оно ровно
    // в поток отказов вендора, то есть когда система уже деградирует. Контрфакт того же прибора:
    // с отменой +4 дескриптора вместо +400.
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderError(
      provider,
      'http',
      `HTTP ${res.status} (тип ${ctype}, длина ${declared}; тело не логируется — правило разглашения)`,
    );
  }

  // ЧТЕНИЕ ТЕЛА ОБЯЗАНО ЖИТЬ ВНУТРИ try — иначе целый КЛАСС отказов уходит наружу сырым.
  // Найдено ДВУМЯ лейнами круга 2 независимо и замерено обоими: дедлайн, сработавший ПОСЛЕ прихода
  // заголовков (медленный вендор — самый вероятный реальный отказ при 5-секундном сроке), давал
  // сырой DOMException TimeoutError с числовым code=23, а обрыв сокета в середине тела — сырой
  // TypeError('terminated'). Оба МИМО ProviderError, а значит: перевод сертификатного диагноза
  // (он начинается с `instanceof ProviderError`) не применяется, и фильтр отдаёт 500 с полным
  // стеком в журнал вместо документированного 503 UPSTREAM_UNAVAILABLE. То есть штатный отказ
  // вендора превращался в наш «неожиданный сбой» и в ложную тревогу наблюдения.
  // ЧЕСТНО О ВИНЕ: до пака на этом месте стоял `await res.json()` — тоже вне try. Лечение потолка
  // переписало ровно эту строку, объявив своей задачей безопасность этого чтения, и прошло мимо.
  let text: string;
  try {
    text = await readCappedBody(provider, res);
  } catch (err) {
    // ProviderError изнутри readCappedBody (превышение потолка) — уже верного рода, не переоборачиваем:
    // иначе потеряется его kind и причина, ради которых он и бросался.
    if (err instanceof ProviderError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProviderError(
      provider,
      'network',
      `сбой при чтении тела ответа: ${reason} — ЗАПРОС МОГ ДОЙТИ до площадки (заголовки уже пришли), ` +
        `повтор способен создать ДУБЛЬ у получателя`,
      err,
      extractRuntimeErrorCode(err),
      true, // mayHaveArrived: отказ случился ПОСЛЕ приёма запроса площадкой
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ProviderError(provider, 'response', 'invalid JSON in provider response', err);
  }
}

/**
 * ПОТОЛОК ОБЪЁМА ОТВЕТА — ОДИН НА ОБА ЧТЕНИЯ (находки №28 и №55 ре-гейта 15.08.2026).
 *
 * ЧТО БЫЛО ЗАМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО. `AbortSignal.timeout` ограничивает ВРЕМЯ и не ограничивает
 * ОБЪЁМ: сервер на 127.0.0.1, отдающий ~3 ГиБ, довёл процесс до `Maximum RSS 6 229 264 kB` и
 * `# Fatal error: Check failed: i::kMaxInt >= len (DecodeUTF8)` → **Trace/breakpoint trap (core
 * dumped)**, 45,4 с при дедлайне 5 с. Это НЕ `ProviderError`: `abort()` роняет ВЕСЬ процесс Node,
 * `try/catch` вокруг не помогает, и вместе с ним падают все параллельные запросы API. Дедлайн
 * держит только пока чтение не насыщено (на 1 МиБ/с он сработал ровно за 5007 мс).
 *
 * ПОЧЕМУ ФУНКЦИЯ ОДНА НА ДВА ПУТИ. Первая находка была названа по пути ОТКАЗА (`res.text()`), но
 * тело читается ДВАЖДЫ, и второй путь — `res.json()` на УСПЕХЕ — нормальный: по нему идёт каждый
 * удачный ответ, и гигантское тело там ВЕРОЯТНЕЕ (отказ обычно короткий). Починка одного места
 * оставила бы открытым то, по которому ходят всегда — класс «ось-встречающая»: проверка на само
 * лечение ставится ДО лечения. Поэтому потолок ставится ЗДЕСЬ, в единственном месте чтения.
 *
 * ФОРМА ЗАЩИТЫ: сначала объявленный `content-length` (дёшево и отсекает честного гиганта), затем
 * — обязательно — счёт ФАКТИЧЕСКИ прочитанных байт по кускам, потому что заголовку верить нельзя:
 * его может не быть вовсе (`chunked`), и он может лгать. Поток закрывается сразу на превышении:
 * читаем ровно до потолка + 1 байт, а не «до конца, а потом посмотрим».
 */
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 МиБ — на два порядка больше любого ответа наших вендоров

async function readCappedBody(provider: string, res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    // Та же причина, что и на ветке не-2xx: бросить, не распорядившись телом, значит оставить
    // соединение висеть. Здесь мы ещё не начинали читать — отменяем поток целиком.
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderError(
      provider,
      'response',
      `ответ провайдера объявил ${declared} Б при потолке ${MAX_RESPONSE_BYTES} Б — тело не читалось`,
    );
  }

  const body = res.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        // Рвём соединение НЕМЕДЛЕННО: дочитывать гигантское тело, чтобы затем его отбросить, —
        // это тот же расход памяти и времени, от которого мы защищаемся.
        await reader.cancel().catch(() => undefined);
        throw new ProviderError(
          provider,
          'response',
          `ответ провайдера превысил потолок ${MAX_RESPONSE_BYTES} Б — чтение прервано`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}
