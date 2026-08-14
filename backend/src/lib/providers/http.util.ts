import { isAllowedProviderHost, RF_ALLOWED_PROVIDER_HOSTS } from '../../config/env.validation';
import { ProviderError } from './provider-error';

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
  if (!isAllowedProviderHost(host)) {
    // Сообщение НЕ содержит самого URL: у части провайдеров ключ живёт в адресной строке
    // (vendor-mandated), и печатать адрес значило бы разгласить секрет в журнале.
    throw new ProviderError(
      provider,
      'config',
      `хост «${host}» НЕ в перечне исходящего периметра (ADR-0017 / ФЗ-152 ст.18 ч.5) — ` +
        `запрос не отправлен. Разрешены: ${(RF_ALLOWED_PROVIDER_HOSTS as readonly string[]).join(', ')} ` +
        `(плюс своё: loopback / RFC1918 / односегментное имя). Новый провайдер добавляется код-ревью.`,
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
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProviderError(provider, 'network', `request failed: ${reason}`, err);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(provider, 'http', `HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new ProviderError(provider, 'response', 'invalid JSON in provider response', err);
  }
}
