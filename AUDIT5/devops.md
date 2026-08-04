# AUDIT5 · devops — оси 6 (устойчивость) · 8 (наблюдаемость) · 9 (обратимость)

> Репо `/home/asulimenko/Project/workspace/ZooLink`, ветка `backend`, HEAD `c44874c`, миграции 0001–0040.
> Даты замеров: 2026-08-04. Продуктовый код НЕ менялся; host-PG/Redis НЕ трогались (DDL — только на
> эфемерном кластере, он снят за собой).

---

## 0. ЧЕГО ЭТИ ОСИ НЕ УВИДЯТ (читать до выводов)

Пустая клетка обязана быть видна как пустая.

| не проверено | почему | чем это опасно |
|---|---|---|
| **PostgreSQL 16** (прод-цель, `docker-compose.yml`) | в песочнице доступен только PG **14.19** | быстрый DEFAULT, `GENERATED ALWAYS AS IDENTITY`, генерируемые колонки ведут себя в 14 и 16 одинаково, но **абсолютные тайминги и планы — нет**. Класс блокировки переносится, секунды — нет |
| **абсолютные секунды как прод-числа** | ноутбучный SSD, `shared_buffers` 128 MB, `fsync=on`, нулевая конкурентная нагрузка | числа ниже доказывают **форму O(строк) и класс замка**, а не бюджет прод-окна |
| **реальный rolling deploy двух сборок** | N-1 симулирован **старым SQL** (старый список колонок), а не запущенным старым образом | Prisma-клиент старой сборки против уехавшей схемы не проверен |
| **миграции 0001–0034** | вне задания | |
| **отказ PG / S3 / worker вживую** | эмпирически поднят и убит только Redis; PG-выключение, MinIO-выключение и смерть worker'а оценены **чтением кода**, не прогоном | ось 6 по этим трём зависимостям — гипотеза, а не замер. Помечено ниже словом «статически» |
| **алертинг вживую** | ось 8 — статический разбор (порождённый агент), не рантайм-проверка | «метрики нет» доказано грепом, «алерт не придёт» — следствие, не замер |
| **оси 1–5, 7, 10–13** | не входили в задание | пиксель, края, время-накопление, чужое, цена, совместимость, полнота класса, счастливый путь, адресность — **никем в этом заходе не смотрены** |
| **бэкап как механизм** | проверена документированная **процедура**; наличия крона/юнита, который её исполняет, в репо нет — проверять нечего | см. Д-14 |

**Самопойманная ошибка (в пользу честности числа).** Первый прогон восстановления показал
`consents 100001 → 100002` и я едва не записал «restore дублирует строки». Перепрогон на чистой
БД дал **0 восстановленных строк** — лишняя строка была от моих же N-1 тестов, а не от restore.
В отчёт попал перепроверенный факт. Антарая пойманного: `бхранти-даршана`.

---

## 1. ВЕРДИКТЫ ОСЕЙ

| ось | вердикт | одной строкой |
|---|---|---|
| **9 · обратимость** | 🔴 **NO-GO** | Down-миграций в репо **ноль** (0 из 40). Документированный restore при прогоне **не восстанавливает ничего и выходит с кодом 0**. Две из шести миграций — **односторонние двери**, доказано замером. |
| **6 · устойчивость** | 🔴 **NO-GO** | Redis — жёсткая зависимость **каждого** запроса: при живом API и мёртвом Redis `/health/live` (документирован как «без зависимостей») отдаёт **HTTP 500**; при мёртвом Redis на старте процесс **не поднимается вовсе**. Замерено. |
| **8 · наблюдаемость** | 🔴 **NO-GO** | `/metrics` отвечает на **0 из 10** вопросов «что сломалось». Worker — чёрный ящик (нет health, нет метрик, healthcheck выключен, Sentry не инициализирован). Канал ошибок Prisma подключён к несуществующему слушателю. |

Стенд замеров: эфемерный PG 14.19 (`/tmp/audit5-pg`, снят). База = `database_schema.sql` на коммите
`64f0aa8^` (состояние после 0034, 37 таблиц), восстановлена из git. Налив: 200 users · 100 000 animals ·
**100 000 listings (56 MB)** · **100 000 consents (15 MB)**.

---

## 2. НАХОДКИ

Блокирует, по правилу остановки, только **тихий отказ** и **вред, видимый владельцу**. Остальное — открытый хвост.

### 🔴 Д-1 · BLOCKER · миграция 0035 безвозвратно уничтожает `listings.updated_at`
**Антарая:** `бхранти-даршана` (замер мерил новую колонку и не посмотрел, что запись сделала со старой) ·
`прамада` (про этот самый триггер миграция и написана — и на него же наступила).
**Где:** `migrations/20260708_0035_listings_content_version.sql:60`

```sql
UPDATE listings SET content_updated_at = updated_at;
```

На `listings` висит `update_listings_updated_at → update_updated_at_column` (миграция 0013). Этот
BEFORE-триггер срабатывает на бэкфилле и ставит `updated_at = now()` **каждой строке таблицы**.

Замер (100 000 строк):

```
BEFORE migration: distinct updated_at = 2 , min=2026-08-04 13:32:59.505115+03
AFTER  migration: distinct updated_at = 1 , min=2026-08-04 14:15:02.912637+03   ← время миграции
AFTER  rollback : distinct updated_at = 1 , min=2026-08-04 14:15:02.912637+03   ← НЕ восстановилось
```

`content_updated_at = updated_at` после миграции — **0 из 100 000** строк (значения разъехались ровно
на это). Откат (`ALTER TABLE listings DROP COLUMN content_updated_at`) историю **не возвращает**:
источника для восстановления не существует — единственная колонка, которая её держала, и есть
перезаписанная.

**Ирония по существу:** WHY самой миграции (строки 16–18) — «generic `updated_at` trigger moves on
EVERY UPDATE», а WHY-BETTER (строка 32) обещает «`updated_at` keeps its meaning (physical mtime)».
Миграция делает UPDATE и физический mtime стирает.

**Почему это не поймал ни один гейт.** `migration-drift` в CI (`.github/workflows/ci.yml:107-163`)
проигрывает миграции на **пустой** БД — 0 строк, эффекта не видно. `scripts/check-migration-backfill.sh`
закрывает ровно эту дыру, но покрывает **0032/0033/0036** — 0035 в него не внесена (см. шапку скрипта,
строка «Covered:»).

---

### 🔴 Д-2 · BLOCKER · Redis лежит ⇒ `/health/live` = 500 ⇒ API уходит в цикл перезапуска
**Антарая:** `бхранти-даршана` (эндпоинт объявляет «без зависимостей», путь запроса говорит обратное) ·
`стьяна` (`@SkipThrottle` придуман и применён к `/metrics`, но к health не доехал).
**Где:** `backend/src/lib/rate-limit/rate-limit.module.ts:22` (`APP_GUARD` — глобально) ·
`backend/src/health/health.controller.ts:10,18` (нет `@SkipThrottle`) ·
`node_modules/@nest-lab/throttler-storage-redis/src/throttler-storage-redis.service.js:66`
(`await this.redis.call('eval', …)` — без try/catch).

**Замер (боевой прогон `dist/main.js`, свой эфемерный Redis на 56399, host-Redis 6379 не тронут):**

```
########## ФАЗА 1 — Redis жив ##########
/health/live   : HTTP 200  {"status":"ok"}
/health/ready  : HTTP 200  {"status":"ok","info":{"postgres":{"status":"up"},"redis":{"status":"up"}}}
########## Redis убит ##########
API process: ALIVE
########## ФАЗА 2 — Redis мёртв ##########
/health/live   : HTTP 500  {"title":"INTERNAL SERVER ERROR","status":500,"code":"INTERNAL"}
/health/ready  : HTTP 500
/v1/listings   : HTTP 500
```

Из лога (стек в `ProblemExceptionFilter` на `GET /health/live`):
`MaxRetriesPerRequestError: Reached the max retries per request limit (which is 3)` — бросает
Redis-хранилище глобального `ThrottlerGuard` **до** контроллера.

`health.controller.ts:18` при этом говорит дословно:
`/** Liveness: process is up. No dependency checks (used by orchestrator restarts). */`

**Вторая половина каскада — старт.** Тот же прогон с мёртвым Redis **на старте**:

```
PROCESS DEAD
Error: Connection is closed.
    at EventEmitter.connectionCloseHandler (node_modules/ioredis/built/Redis.js:220:28)
Node.js v20.20.2
```

Необработанный reject убивает процесс (обработчика `process.on('unhandledRejection')` в дереве нет).

**Сцепка, ради которой это BLOCKER:** `backend/Dockerfile:35-36` проверяет `/health/live`,
`docker-compose.yml:66-70` — `/health/ready`; при недоступном Redis обе пробы красные ⇒ контейнер
нездоров ⇒ `restart: unless-stopped` (`docker-compose.yml:57`) перезапускает ⇒ **подняться он уже не
может**. Кратковременная просадка Redis превращает *деградировавший* API в *циклически падающий*,
и он не выйдет из цикла, пока Redis не вернётся. `worker.module.ts:25` импортирует `RedisModule` —
worker ложится тем же способом.

Оговорка: направление «fail-open или fail-closed для rate-limit» — решение security/architect, не моё.
Я фиксирую замер: сегодня это не fail-closed, а **полный отказ сервиса, включая liveness**.

---

### 🔴 Д-3 · BLOCKER · документированный restore ничего не восстанавливает и рапортует успех
**Антарая:** `аласья` («должно работать» вместо прогона) · `бхранти-даршана` (сигнал успеха = код
возврата psql, который меряет не то).
**Где:** `docs/06-operations/deployment-mvp.md:74-78`

Прогон команды **дословно** на живой популированной БД (сценарий, ради которого она написана —
плохой деплой, БД существует и содержит испорченные данные):

```
BEFORE: users=200 listings=100000 consents=100000
psql exit=0   errors=351
AFTER : users=200 listings=100000 consents=100000        ← восстановлено НОЛЬ строк
```

Классы ошибок: `188 relation … already exists`, `77 constraint …`, `37 multiple primary keys for table`,
`30 trigger …`, `11 function …`, `8 duplicate key value`.

Та же команда на **пустой** БД: `errors=0`, данные корректны. То есть процедура работает только для
случая «база уже удалена», а runbook нигде не говорит её удалить, и не содержит ни `--clean`, ни
`DROP/CREATE DATABASE`, ни `-v ON_ERROR_STOP=1`.

Оператор в аварии видит exit 0, делает `docker compose restart api worker` (строка 77) и считает
восстановление успешным. Это тихий отказ на последнем рубеже.

Сопутствующее: сам бэкап документирован как «cron on host or `worker`» (строка 69), но ни в
`docker-compose.yml`, ни в `scripts/`, ни в systemd-юнитах репо нет ничего, что его исполняет.
Объявление есть, механизма нет — `стьяна`.

---

### 🔴 Д-4 · BLOCKER · провайдеры SMS/email в проде молча подменяются заглушкой
**Антарая:** `бхранти-даршана` (зелёный `/health/ready` при полностью неработающей регистрации).
**Где:** `backend/src/lib/providers/providers.module.ts:24-31` и `:38-51` ·
`backend/src/config/env.validation.ts:132,135,139`

```ts
if (cfg.get('SMS_PROVIDER') === 'smsru' && cfg.get('SMSRU_API_ID')) { … }
log.warn('SMS provider: STUB (no credential configured)');
return new StubSmsProvider();
```

```ts
SMSRU_API_ID:        z.string().optional().default(''),
UNISENDER_API_KEY:   z.string().optional().default(''),
YANDEX_MAPS_API_KEY: z.string().optional().default(''),
```

Для `AGENT_SERVICE_SIGNING_SECRET` (`:218`) и `METRICS_TOKEN` (`:230`) продакшн-замок есть и работает
— я в него упёрся при первом боевом старте:
`METRICS_TOKEN: required in production (min 16 chars)` ⇒ процесс не поднялся. Правильно.
Для учётных данных провайдеров такого замка **нет**.

Следствие: деплой с опечаткой в `SMSRU_API_ID` поднимается зелёным, `/health/ready` = 200, и **ни одна
OTP не уходит** — регистрация мертва при полностью здоровых индикаторах. Единственный след — один
`warn` в момент старта, в неагрегируемый json-file (Д-12).

Деградация-в-заглушку сама по себе спроектирована хорошо (адаптеры `stub-*` есть для sms/email/maps/
payment/storage). Дефект — **отсутствие продакшн-гейта** на выбор заглушки.

---

### 🟠 Д-5 · HIGH · 0035 держит `listings` под AccessExclusiveLock весь бэкфилл — таблица недоступна целиком
**Антарая:** `самшая` (в шапке миграции «N-1 rolling-deploy write-compat» — про установившийся режим;
про окно самой миграции не сказано ничего).
**Где:** `migrations/20260708_0035_listings_content_version.sql:51-62` (`DO $$ … $$` = одна транзакция:
`ALTER TABLE` + полнотабличный `UPDATE`; замок держится до COMMIT).

Разложение стоимости (100 000 строк / 56 MB):

```
ALTER TABLE listings ADD COLUMN content_updated_at … DEFAULT now();   Time: 1.885 ms   ← быстрый DEFAULT, перезаписи нет
UPDATE listings SET content_updated_at = updated_at;                  Time: 21453.013 ms
```

`relfilenode` не менялся (18139 → 18139) — ALTER честно метаданными. Всю цену платит UPDATE.

Полное время миграции, 5 прогонов с чистого восстановления: **4.976 · 13.584 · 4.898 · 5.72 · 12.635 s**
(разброс 4.3×; окно недоступности непредсказуемо). Физический размер `listings` 56 MB → **89 MB**
(MVCC-раздувание от полной перезаписи строк).

Во время миграции (замер, `lock_timeout=1s`):

```
читатель  : ERROR: canceling statement due to lock timeout   (SELECT count(*) FROM listings)
N-1 писарь: ERROR: canceling statement due to lock timeout   (INSERT INTO listings …)
pg_locks  : AccessExclusiveLock on listings granted=true
```

И симметрично — миграция встаёт за любой открытой читающей транзакцией:

```
ERROR: canceling statement due to lock timeout
CONTEXT: SQL statement "ALTER TABLE listings ADD COLUMN content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
```

Форма O(строк) линейна: 100 k ≈ 5–21 с ⇒ 1 M ≈ 50–215 с **полной** остановки самой горячей таблицы.
Разделение на «ALTER отдельной транзакцией + бэкфилл пакетами» стоило бы почти ничего — вопрос к
architect, не правка от меня.

---

### 🟠 Д-6 · HIGH · 0035 в rolling-окне даёт ПОТЕРЮ ЗАПИСИ (N-1 правит контент, ETag не крутится)
**Антарая:** `бхранти-даршана` (N-1-совместимость доказана для INSERT и объявлена для всего).
**Где:** шапка миграции строки 39-40 и 48-49 (проверяет только INSERT) ·
`backend/src/modules/listing/listing.service.ts:1322` ·
`assertIfMatch` на `:327`, `:451`, `:744`.

```ts
return weakEtag(`listing:${row.id}`, row.content_updated_at);
```

Замер — N-1 под правит содержимое так, как умеет старый код (без новой колонки):

```
before: content_updated_at=2026-08-04 13:32:59.505115+03
UPDATE listings SET title_localized='{"ru":"N-1 edit",…}', updated_at=now() WHERE …
after N-1 content edit: content_updated_at=2026-08-04 13:32:59.505115+03 | updated_at=2026-08-04 14:04:10.317226+03
```

`content_updated_at` не сдвинулся ⇒ **ETag не сменился**. Цепочка в смешанном флоте:
редактор A (N+1) читает объявление и получает ETag E → редактор B (N-1) меняет заголовок →
ETag всё ещё E → A шлёт `If-Match: E` → **412 не срабатывает** → правка B молча затирается.

Это ровно тот класс, ради предотвращения которого оптимистичная блокировка и существует. Окно —
время раскатки, но отказ **тихий**: ни лога, ни 412, ни следа.

---

### 🟠 Д-7 · HIGH · 0040 §C — односторонняя дверь: после первой строки `REVIEW_PUBLICATION` откат невозможен
**Антарая:** `авирати` (форму завели, проверку до боевого режима — «а если тумблер уже включали» — не довели).
**Где:** `migrations/20260710_0040_reputation_storage.sql:183-187`

Замер. Смоделирован один день с включённым `feature_toggles.reputation_reviews` (1 согласие, 1 сделка,
1 отзыв), затем попытка отката:

```
-- шаг 2: сузить CHECK обратно к словарю 0029/0039
ERROR: check constraint "chk_consents_consent_type" of relation "consents" is violated by some row

-- шаг 4: удалить мешающую строку, чтобы разблокировать сужение
ERROR: consents is append-only; UPDATE/DELETE is not allowed
CONTEXT: PL/pgSQL function trg_block_modify_append_only() line 3 at RAISE
```

Выходов ровно два, и оба не откат: отключить `trg_consents_immutable` (уничтожив ФЗ-152-неизменяемость
и юридический след) либо оставить CHECK расширенным навсегда. `DROP TABLE reviews/reputation_aggregates`
при этом проходит — то есть откат §A/§B возможен, а §C — нет; «частичный откат» здесь означает
рассогласованное состояние.

Сегодня это латентно (`reputation_reviews` = OFF, `REVIEW_PUBLICATION` никем не пишется). Но тумблер
для того и заведён, чтобы его включить, и ни миграция, ни ADR-0039, ни какой-либо runbook об этом
пороге не предупреждают.

---

### 🟠 Д-8 · HIGH · строку `confirmed_sales` нельзя ни исправить, ни удалить
**Антарая:** `алабдха-бхумикатва` (ступень «жизненный цикл записи-истины» не взята: словарь статусов
объявлен, переходы структурно недостижимы).
**Где:** `migrations/20260710_0039_confirmed_sales.sql` (CHECK статусов + `trg_confirmed_sales_immutable`).

```
DELETE FROM confirmed_sales WHERE status='CONFIRMED';
ERROR: confirmed_sales is append-only; UPDATE/DELETE is not allowed
UPDATE confirmed_sales SET status='CANCELLED';
ERROR: confirmed_sales is append-only; UPDATE/DELETE is not allowed
```

CHECK резервирует пять статусов (`PENDING_CONFIRMATION|CONFIRMED|DISPUTED|EXPIRED|CANCELLED`), но
BEFORE UPDATE-триггер делает **любой** переход невозможным: строка может существовать только в том
статусе, в котором родилась. Единственный доступный «откат» — `DROP TABLE` (проверено, проходит),
то есть потеря всей записи-истины.

**Частично это объявленный долг, и это честно:** шапка 0039 сама помечает `FLAGGED (behaviour slice/
architect): append-only vs markSold PENDING→CONFIRMED transition mechanics deferred`. Не объявлено
другое: **ошибочно захваченная сделка неисправима**. Пассивный захват уже живой (`transfer.service`
пишет строку в транзакции accept), а `reviews` (0040) ссылается на `confirmed_sales` и репутация
будет выводиться из неё ⇒ единственная кривая строка становится вечным входом репутации без
компенсирующего механизма.

---

### 🟡 Д-9 · MEDIUM · down-миграций в репозитории ноль; откат всех 40 — гипотеза
**Антарая:** `стьяна` (в `deployment.md:180-183` «Data migrations written to be reversible where
possible» — объявление; исполнения нет).
**Замер:**

```
ls migrations/ | grep -iE "down|rollback|revert"   → NONE
find . -iname "*rollback*" -o -iname "*down*.sql"  → пусто
backend/package.json                                → нет db:migrate / db:rollback
```

Откаты в Д-1/Д-7/Д-8 я писал сам, чтобы было что проверять. Их не существует — а значит и
«проверенного отката» не существовало ни для одной из 40 миграций до этого прогона.

Смежное: `docs/06-operations/deployment.md` (Status: **Draft**, 2026-06-13) — единственный документ с
заголовком «Rollback Procedures», и он написан под Kubernetes: «kubectl commands», «HPA», «resource
quotas per namespace». Это прямо противоречит ADR-0009 (MVP — модульный монолит, **без K8s**).
Оператор в аварии первым найдёт инструкцию для архитектуры, которую проект отверг.

---

### 🟡 Д-10 · MEDIUM · outbox: ~21 минута до dead-letter, дальше — ни возврата, ни границы
**Антарая:** `стьяна` (мёртвая буква: `dead_lettered_at` только пишется, никем не читается).
**Где:** `backend/src/lib/outbox/backoff.ts:6,14-17` · `outbox.relay.ts:140-150`

`MAX_ATTEMPTS = 8`, задержки `10·2^(n-1)` с потолком 3600 с ⇒ 10+20+40+80+160+320+640 = **1270 с ≈ 21 мин**
от первого отказа до безвозвратного dead-letter. Столько есть у оператора, чтобы починить внешнюю
зависимость — и узнать о ней он может только из одной строки лога.

Пути возврата нет: `dead_lettered_at` в коде встречается ровно дважды —
`outbox.relay.ts:97` (фильтр `WHERE … dead_lettered_at IS NULL`) и `:146` (запись). Ни requeue-команды,
ни админ-эндпоинта, ни скрипта. Восстановление = ручной SQL по таблице, о существовании проблемы в
которой ничто не сообщает.

Пруна/ретенции у `outbox_events` нет нигде (ни в `migrations/*.sql`, ни в `src/lib/scheduler/`) — рост
неограничен. Это осознанно (`notification.consumer.ts:17`: «never prune outbox_events before an
analytics projection»), но без метрики размера (Д-11) неограниченный рост невидим.

Положительное, отмечаю честно: `claim()` (`:92-102`) берёт **аренду**, а не попытку —
`FOR UPDATE SKIP LOCKED` + `next_attempt_at = NOW() + 60s`, `attempts` растёт только в `onFailure`.
Упавший worker не сжигает бюджет попыток; при возврате события переигрываются. Смерть worker'а
события **не теряет** — она их копит.

---

### 🟡 Д-11 · MEDIUM · наблюдаемость: `/metrics` отвечает на 0 из 10 вопросов «что сломалось»
*(порождённый агент, статический разбор; команды воспроизводимы)*

Все пользовательские метрики проекта — **одна**:

| метрика | тип | метки | где |
|---|---|---|---|
| `zoolink_audit_actions_total` | Counter | `principal_type`, `action` | `backend/src/lib/audit/audit.metrics.ts:22-27` |

Остальное на `/metrics` — `collectDefaultMetrics` (`metrics.service.ts:11`): heap, event-loop lag, fds.
`rg -n "new (Counter|Histogram|Gauge|Summary)\(" backend/src -t ts` → одно совпадение.

Видимость десяти отказных событий в `/metrics`: outbox dead-letter **нет** · падение консьюмера **нет** ·
рост backlog'а outbox **нет** · провал миграции **нет** · 429/исчерпание квоты **нет** (счётчика
статус-кодов нет вообще) · потеря PG **нет** · потеря Redis **нет** · сбой S3 **нет** · ошибки
аутентификации **нет** (считаются только *успешные* привилегированные действия) · смерть worker'а
**нет** — и структурно невозможна: `worker.module.ts:20-36` не импортирует `MetricsModule` и HTTP-порта
не слушает.

Что зелёный `/health/ready` (`health.controller.ts:26-31` — `SELECT 1` + `PING`) **не** доказывает:
жив ли worker · тянется ли outbox · доступен ли MinIO (исключён явно, `docker-compose.yml:63-64`) ·
идут ли крон-задачи · **пишется** ли БД (`SELECT 1` пройдёт на read-only/переполненном диске).

Худшая дыра — **worker как чёрный ящик**: `healthcheck: {disable: true}` (`docker-compose.yml:82-83`),
нет `/metrics`, нет `/health`, и `initSentry` в `backend/src/worker.ts` **не вызывается** (в
`main.ts:13` вызывается) — при том что `sentry.ts:6` документирует «Called from main.ts/worker.ts».
Все ошибки outbox-релея, консьюмеров и крон-задач проходят мимо Sentry целиком.

---

### 🟡 Д-12 · MEDIUM · канал ошибок Prisma подключён к слушателю, которого нет
**Антарая:** `стьяна` (конфигурация есть, приёмника нет).
**Где:** `backend/src/lib/db/prisma.service.ts:12-19`

```ts
super({ log: [ { level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' } ] });
```

`emit: 'event'` уводит warn/error в EventEmitter, а `$on` не вызывается нигде:
`rg -n '\$on\(' backend/src -t ts` → пусто. Каждое предупреждение и каждая ошибка уровня Prisma
(таймауты пула, ошибки запросов) уходят в никуда. Это не catch-блок — это мёртвый канал целиком.

Рядом: `backend/src/lib/db/kysely.service.ts:21-27` создаёт `pg.Pool` **без** `pool.on('error', …)`.
Ошибка простаивающего клиента на пуле без слушателя — необработанное событие `error` EventEmitter'а,
то есть падение процесса. Единственный зарегистрированный обработчик ошибок во всём дереве —
`redis.service.ts:16` (`rg -n "\.on\('error'" backend/src` → одно совпадение).

Проглоченных исключений в проде — **7** «настоящих» из 36 catch-блоков (24 из 36 — осознанное
отображение ошибок Prisma в RFC7807, это сделано аккуратно). Самое дорогое:
`backend/src/lib/http/idempotency.interceptor.ts:123,128` — `void this.redis.client.set(…)` без
`.catch()`. Комментарий на `:121-122` обещает «Failure to cache must not fail the request», но при
недоступном Redis это необработанный reject — а его летальность на Node 20 я **замерил** в Д-2
(`Error: Connection is closed.` → `Node.js v20.20.2` → процесс мёртв). Обработчика
`process.on('unhandledRejection')` в дереве нет.

---

### 🔵 Д-13 · LOW/ЛАТЕНТНО · бэкфилл IDENTITY идёт в ФИЗИЧЕСКОМ порядке, а не в порядке вставки
**Антарая:** `самшая` (утверждение подано как гарантия, гарантией не являясь).
**Где:** `migrations/20260708_0036_consents_monotonic_seq.sql:40-41` — дословно:
«back-fills existing rows in **physical (insertion) order**». PostgreSQL такого не обещает; физический
порядок совпадает с порядком вставки только у кучи, которая никогда не переиспользовала свободное место.

Контрпример, прогнан:

```sql
INSERT 1000 строк; DELETE строк 1..200; VACUUM;      -- освободили место в ранних страницах
INSERT VALUES (9999,'NEWEST-ROW');                    -- новейшая строка легла в РАННЮЮ страницу
ALTER TABLE ord_demo ADD COLUMN seq BIGINT GENERATED ALWAYS AS IDENTITY;
→ NEWEST-ROW got seq=1 ; max seq in table=801
→ rows with a HIGHER seq than the newest row: 800
```

Записанная последней строка получила `seq = 1`. Для `consents` это перевернуло бы ровно ту
причинно-следственную гарантию, ради которой 0036 и написана (ФЗ-152 ст.9 ч.2 — отзыв обязан
подействовать).

**Сегодня безопасно, но по случайности, а не по замыслу:** удаление из `consents` заблокировано
append-only-триггером, поэтому свободное место не появляется. Проверка цикла вниз-вверх на реальной
таблице:

```
rows whose seq CHANGED after down/up: 0   (из 100 000)
```

Ломается это тремя штатными действиями: `VACUUM FULL`/`pg_repack`/`CLUSTER` перед повторным
добавлением колонки, либо идиомой `ALTER TABLE … DISABLE TRIGGER`, которую **используют собственные
e2e-тесты проекта** (зафиксировано в `ZooLink/CLAUDE.md` как GOTCHA для 0039/0040). Та же формулировка
и та же ставка повторены в 0040 для `reviews.seq`.

---

### 🔵 Д-14 · LOW · разнородная атомарность миграций + долг автовакуума после 0036

**Атомарность.** 0038/0039/0040 обёрнуты в `BEGIN … COMMIT` — проверено: при lock_timeout вся
транзакция 0040 откатывается чисто, частичного состояния не остаётся. 0035/0036/0037 явной транзакции
**не имеют**: 0035 — это `DO`-блок (транзакция) плюс два отдельных `CREATE OR REPLACE FUNCTION`. Обрыв
между ними оставляет колонку заведённой, а каскадные функции — в теле версии 0025 (без бампа
`content_updated_at`). Повторный прогон чинит, но состояние между — рассогласованное и ничем не
помеченное.

**Перезапись и её хвост.** 0036 — единственная из шести, кто **переписывает таблицу**:
`relfilenode 25544 → 26545` (добавление IDENTITY быстрым DEFAULT'ом не обходится), 0.487 с на
100 000 строк, 15 MB → 22 MB. Само по себе дёшево, но хвост измеряем: миграция 0038, запущенная сразу
следом, заняла **9.094 с** против **0.047–0.081 с** на успокоившемся кластере — **100-кратная**
разница из-за конкуренции с автовакуумом. DDL самой 0038 — 13 мс суммарно (замерено пооператорно).
Для последовательной раскатки шести миграций подряд это значит: время окна определяется не суммой
миграций, а хвостом перезаписи.

**Смежная находка при проверке отката 0036:** `DROP COLUMN seq` — 0.077 с, перезаписи **нет**
(`relfilenode` не изменился), то есть технически откат дёшев. Но `ConsentService` (N+1) сортирует по
`seq DESC` — снятие колонки под живым новым кодом кладёт всё разрешение согласий. Порядок «сначала
откатить код, потом схему» нигде не записан.

---

### ℹ️ Д-15 · INFO · `users` нельзя удалить: `ON DELETE CASCADE` обещает то, чего не может
**Где:** `consents_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`
против `trg_consents_immutable BEFORE DELETE OR UPDATE`.

```
DELETE FROM users WHERE id='…';
ERROR: consents is append-only; UPDATE/DELETE is not allowed
CONTEXT: SQL statement "DELETE FROM ONLY "public"."consents" WHERE $1 OPERATOR(pg_catalog.=) "user_id""
after user DELETE, consents rows remaining: 1
```

Два объявления в одной схеме противоречат друг другу: FK обещает каскадное удаление, триггер запрещает
его всегда. Практического вреда сегодня нет — приложение стирает анонимизацией на месте
(`admin-user.service.ts:211-242`, `erased_at`), а не физическим удалением. Но `ON DELETE CASCADE` здесь
— мёртвая буква, которая **лжёт о модели стирания**, и любая операторская чистка (или откат, снимающий
тестового пользователя) упрётся в ошибку, называющую `consents`, а не `users`. Та же пара повторена в
0040: `reviews.confirmed_sale_id → confirmed_sales(id) ON DELETE CASCADE` при append-only
`confirmed_sales`.

---

## 3. ЧТО СДЕЛАНО ХОРОШО (чтобы не сняли по ошибке)

- **Аренда, а не попытка** в outbox (`outbox.relay.ts:92-102`, `FOR UPDATE SKIP LOCKED` + visibility
  timeout): упавший worker не сжигает бюджет попыток, события переигрываются. Смерть worker'а события
  не теряет.
- **Fail-fast валидация env** — замерена вживую: `METRICS_TOKEN: required in production` остановил
  мой первый боевой старт. `AGENT_SERVICE_SIGNING_SECRET` защищён так же.
- **`GENERATED ALWAYS` держит слово:** `INSERT … seq=999999` → `ERROR: cannot insert a non-DEFAULT
  value into column "seq"`. N-1 вставка без колонки проходит (`seq=100001`). То же для
  `reputation_aggregates.rating_avg` — «покупаемый рейтинг» невозможен структурно, а не по комментарию.
- **N-1 INSERT-совместимость подтверждена замером для всех шести** миграций: listings без
  `content_updated_at` (DEFAULT сработал), consents без `seq`, service_credentials без четырёх новых
  колонок (все nullable), старый `consent_type='MARKETING'` после расширения CHECK — принимается.
- **CI-гейты миграций сильные**: `migration-drift` (двойной прогон + блокирующий DDL-диф,
  `ci.yml:107-163`) и `check-migration-backfill.sh` (бэкфилл на **популированных** данных). Шапка
  последнего честно объясняет, почему пустая таблица ничего не доказывает — Д-1 существует ровно
  потому, что 0035 в этот список не внесли.
- **Заглушки провайдеров** есть для sms/email/maps/payment/storage — деградация спроектирована;
  недостаёт только продакшн-гейта (Д-4).
- **`MetricsGuard`** (`metrics.guard.ts:23-35`): fail-closed, 404 без утечки, сравнение токена за
  константное время, откат на RFC1918.

---

## 4. КОРОТКО ДЛЯ ГЕЙТА

**NO-GO по трём осям.** Блокирующих (тихий отказ / вред, видимый владельцу) — четыре:
Д-1 (безвозвратная потеря `updated_at`), Д-2 (Redis ⇒ 500 на liveness ⇒ цикл перезапуска),
Д-3 (restore рапортует успех, не восстановив ничего), Д-4 (прод молча уходит в заглушку SMS).

Открытый хвост: Д-5…Д-15.

Ни одна правка продуктового кода не вносилась; эфемерный PG-кластер и эфемерный Redis сняты.
