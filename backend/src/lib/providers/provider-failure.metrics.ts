import { Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
import type { ProviderErrorKind } from './provider-error';

const METRIC_NAME = 'zoolink_provider_failures_total';

/**
 * ПРАВИЛО ТРЕВОГИ:  zoolink_provider_failures_total{kind="config"} > 0  →  ЭТО НАША ПОЛОМКА, НЕ ВЕНДОРА
 *
 * Держится одной строкой рядом с кодом, который её кормит: правило без посылки бесполезно, а
 * посылку следующий читатель (или более слабая модель) не обязан выводить заново.
 */
const ALERT_RULE = 'ALERT on kind="config" > 0 (постоянный отказ НАШЕЙ конфигурации)';

/**
 * ОТКАЗ ПЕРИМЕТРА ОТЛИЧИМ ОТ ПАДЕНИЯ ВЕНДОРА (находка №145).
 *
 * ЧТО БЫЛО ЗАМЕРЕНО ЧТЕНИЕМ: `ProviderError.kind` заведён отвечать на вопрос «чинить или ждать»,
 * но единственное место, где эта ошибка доходит до человека (`problem.filter.ts`), выдавало ОДИН
 * `logger.error` и ОДИН 503 для всех четырёх родов; `Sentry.captureException` стоял только в ветке
 * «неожиданная ошибка», то есть `kind=config` — ПОСТОЯННЫЙ отказ нашей конфигурации — не будил
 * никого. Метрик у исходящих не было ни одной (греп: счётчики есть у rate-limit и audit, у
 * lib/providers — ноль). Различение существовало В ТИПЕ и терялось на последнем метре.
 *
 * ЧЕМ ЭТО БЬЁТ: вендор сменил хост, кто-то завёл адаптер мимо перечня, кто-то откатил дверь
 * рубильником — во всех трёх случаях наружу шло «An upstream service is temporarily unavailable»,
 * в журнал — строка, неотличимая от вендорской сетевой шумихи, в /metrics — ничего, в Sentry —
 * ничего. Дежурный ждал бы, «пока вендор поднимется».
 *
 * ── ПОЧЕМУ ИМЕННО ЭТИ МЕТКИ ──────────────────────────────────────────────────────────────────
 * `kind` — ровно тот вопрос, ради которого поле заведено: `config` = чинить У СЕБЯ (хост вне
 * перечня, схема не та, редирект, снятая дверь) · `network`/`http`/`response` = сторона вендора.
 * `provider` — чтобы отличить «лежит один вендор» от «сломан наш периметр СРАЗУ У ВСЕХ»: второе
 * и есть подпись отката двери или протухшего перечня, и без этой метки оно неотличимо от первого.
 * Обе метки берутся из ПОЛЕЙ ошибки, а не из запроса, — значит клиент на них не влияет.
 * Мощность ограничена: провайдеров сегодня пять, родов четыре.
 *
 * Обычный класс, а не Nest-провайдер: единственный потребитель — глобальный фильтр, который
 * ставится руками в main.ts. Построенный БЕЗ MetricsService, он говорит об этом ВСЛУХ при
 * создании, а не молча слепнет на первом же потерянном сигнале (тот же приём, что у
 * RateLimitMetrics: так однажды тихо умер zoolink_audit_actions_total).
 */
export class ProviderFailureMetrics {
  private static readonly logger = new Logger(ProviderFailureMetrics.name);
  private readonly counter?: Counter<'provider' | 'kind'>;

  constructor(metrics?: MetricsService) {
    if (!metrics) {
      ProviderFailureMetrics.logger.warn(
        `No MetricsService: ${METRIC_NAME} will NOT be exported, so the outbound-perimeter alarm ` +
          `(${ALERT_RULE}) is BLIND in this process. Expected in a worker/no-scrape context; ` +
          'in the HTTP API this is a wiring defect — main.ts must pass MetricsService to the filter.',
      );
      return;
    }
    // Идемпотентно: второе построение против того же реестра переиспользует метрику, а не падает
    // на prom-client «already registered».
    const existing = metrics.registry.getSingleMetric(METRIC_NAME);
    this.counter =
      (existing as Counter<'provider' | 'kind'> | undefined) ??
      new Counter({
        name: METRIC_NAME,
        help:
          'Outgoing provider call failed, split by WHO must act. ' +
          `${ALERT_RULE}: kind="config" is a PERMANENT failure of our own configuration ` +
          '(host outside the frozen allowlist, wrong scheme, redirect refused, door rolled back) — ' +
          'waiting for the vendor will never fix it. kind="network"/"http"/"response" is the ' +
          'vendor side. A spike across ALL providers at once is the signature of a broken perimeter, ' +
          'not of one vendor being down — that is what the provider label is for.',
        labelNames: ['provider', 'kind'],
        registers: [metrics.registry],
      });
  }

  record(provider: string, kind: ProviderErrorKind): void {
    this.counter?.inc({ provider, kind });
  }
}
