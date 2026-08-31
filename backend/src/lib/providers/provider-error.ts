/**
 * Uniform failure type for every external-provider adapter. Domain code catches this
 * instead of vendor-specific shapes, and the global RFC7807 filter (ProblemExceptionFilter)
 * maps it to a 503 `UPSTREAM_UNAVAILABLE` Problem with a generic detail (the real message is
 * logged server-side only). `kind` lets callers branch on whether a retry/fallback is sensible.
 */
export type ProviderErrorKind =
  | 'network' // transport/timeout failure — typically retryable
  | 'http' // non-2xx HTTP response from the provider
  | 'response' // 2xx but a provider-level error payload
  | 'config'; // adapter not configured / capability disabled (e.g. payments off)

export class ProviderError extends Error {
  /**
   * ЗАПРОС МОГ ДОЙТИ ДО ПЛОЩАДКИ, хотя ответа мы не получили (находка круга 3, замерена дублями).
   *
   * `kind` отвечает на вопрос «чинить или ждать», а этот признак — на другой: «повтор безопасен?».
   * Замерено на сервере со счётчиком обработанных запросов: дедлайн ПОСЛЕ приёма и обрыв сокета в
   * середине тела дают ProviderError/network, и повтор доводит счётчик до 2 — то есть у ЖИВОГО
   * человека появляется ДУБЛЬ сообщения. Без отдельного признака политика повторов не может
   * отличить «не дошло» от «мог дойти», потому что оба выглядят как сеть.
   */
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly cause?: unknown,
    // Транспортный код рантайма (Node/undici: `DEPTH_ZERO_SELF_SIGNED_CERT`,
    // `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ETIMEDOUT`, …), извлечённый из цепочки `cause`. Причина
    // отказа fetch живёт НЕ в `message` (там всегда «fetch failed»), а на несколько уровней ниже —
    // и без явного поля любой разбор по подстроке `message` промахивается ПО ПОСТРОЕНИЮ.
    readonly code?: string,
    /**
     * ЗАПРОС МОГ ДОЙТИ ДО ПЛОЩАДКИ, хотя ответа мы не получили (находка круга 3, замерена ДУБЛЯМИ).
     * `kind` отвечает на вопрос «чинить или ждать», а этот признак — на другой: «БЕЗОПАСЕН ЛИ ПОВТОР».
     * Замерено на сервере со счётчиком обработанных запросов: дедлайн ПОСЛЕ приёма и обрыв сокета в
     * середине тела дают kind=network, и повтор доводит счётчик до 2 — у ЖИВОГО человека появляется
     * ДУБЛЬ. Без отдельного признака политика повторов не отличит «не дошло» от «мог дойти»: оба
     * выглядят как сеть. Ставится ТОЛЬКО там, где заголовки уже пришли.
     *
     * 🔴 ЧИТАТЬ `false` КАК «НЕ ДОШЛО» — ОШИБКА, И ЭТО НАЗВАНО ПРЯМО (находка круга 4). Признак
     * ставится лишь на путях ПОСЛЕ ответа; на всех прочих он остаётся значением по умолчанию,
     * а значит `false` значит «НЕ ЗНАЮ» — кроме ОДНОГО случая, где мы знаем точно: отказ ДО
     * отправки (хост вне перечня, схема не та) — там запрос не уходил вовсе, и это доказано
     * отдельной осью «отказ ДО приёма НЕ помечен «мог дойти»».
     * Практический вывод для политики повторов: `true` = повтор МОЖЕТ создать дубль (спрашивать
     * идемпотентность), `false` = повтор безопасен ТОЛЬКО если отказ случился до отправки; во всех
     * остальных случаях считать неизвестным и не повторять молча.
     */
    readonly mayHaveArrived: boolean = false,
    /**
     * ПАУЗА, НАЗВАННАЯ САМИМ ВЕНДОРОМ (заголовок `Retry-After`, находка №147). Секунды, целые,
     * неотрицательные; `undefined` = вендор не сказал, и это ЧЕСТНОЕ «не знаю», а не ноль —
     * ноль политика повторов прочла бы как «возвращайся немедленно».
     *
     * ЗАЧЕМ ПОЛЕ, ЕСЛИ ПОЛИТИКИ ПОВТОРОВ ЕЩЁ НЕТ: она приедет в Phase 3 к рубежу, на котором
     * единственное ТОЧНОЕ указание вендора уже утеряно, и будет угадывать паузу. На 429
     * угадывание паузы и есть способ добить вендора и получить бан ключа. Стоимость взять его
     * сейчас — одна строка на границе; стоимость потом — переписывать рубеж под готовую политику.
     */
    readonly retryAfterSeconds?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

/**
 * Первый непустой `.code` в цепочке `.cause` ошибки рантайма. undici бросает `TypeError('fetch
 * failed')` без кода, а НАСТОЯЩАЯ причина (например `DEPTH_ZERO_SELF_SIGNED_CERT`) лежит в
 * `err.cause` уровнем ниже — замерено на живом рантайме, не предположено. Возвращает `undefined`,
 * если кода нет нигде.
 */
export function extractRuntimeErrorCode(err: unknown, depth = 0): string | undefined {
  if (err == null || depth > 6) return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) return code;
  return extractRuntimeErrorCode((err as { cause?: unknown }).cause, depth + 1);
}
