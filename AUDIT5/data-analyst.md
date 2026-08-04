# AUDIT5 · Ось 7 (ЦЕНА) + метрики/событийная модель — data-analyst

**Date:** 2026-08-04 · **Repo:** `ZooLink` branch `backend` · **HEAD:** `c44874c` ·
**Lane:** data-analyst (ось 7 «цена» с названной нагрузкой + North-star instrumentability + событийная модель).
**Method:** re-derived the four hot paths from code, then measured each with `EXPLAIN (ANALYZE, BUFFERS)`
and `pgbench` on an **ephemeral PG14** (`/tmp/audit5-da-pg`, `session_replication_role=replica` for the
synthetic load) seeded to **named N**. Ephemeral cluster torn down at the end; host PG untouched; no product
code/docs changed; this file is my sole output.

**Synthetic load (named, with samples).** Reused the schema's real seed (species 1=dog/pet, 3=cattle/livestock).
Loaded 10 000 ACTIVE listings (70 % with geo, clustered ±5° around 55.75/37.62), 10 000 PENDING_MODERATION
listings (moderation_enqueued_at spread over 0–600 min), 10 000 animals each side, and saved_searches at
**N=1 000 then topped-up to N=10 000** with a realistic filter mix (≈55 % market-pin, ≈25 % species-pin,
≈12 % breed-pin, ≈20 % price-bound, ≈20 % geo, ≈9 % `q`). Trimmed listings to 1 000 for the second scale
point. Loader scripts in scratchpad (`load_base.sql`, `load_listings.sql`, `load_savedsearch.sql`).

---

## 0 · Чего этот лейн НЕ увидит (пустые клетки — честно)

1. **Реального распределения запросов.** Synthetic data is uniform; the real selectivity of the matcher
   (what % of saved searches actually market-pin, real geo clustering, real `q` frequency) is assumed, not
   observed. My match-fraction (2 700/10 000 for one pet listing) is a function of my synthetic mix, not
   production truth. The *shapes* (Seq Scan, O(N), no index) are structural and hold regardless; the exact
   ms scales with real selectivity.
2. **PG14 host vs PG16 prod.** Ephemeral cluster is PG14 (only binaries available). The planner/costs are
   near-identical for these plans, but I cannot certify PG16 row-estimates byte-for-byte.
3. **App-layer overhead not included.** Numbers are raw SQL over a local unix socket. The real request adds
   Prisma marshalling, connection-pool wait, and network — my ms are a **lower bound** on end-to-end latency.
4. **Warm cache.** Reported ms are steady-state (repeated runs); a cold first-hit is higher.
5. **The saved-search fan-out INSERT loop was not run end-to-end** (no worker/Redis up). I measured the scan
   and a single-row UPDATE baseline and reason about the loop from code; the per-pair INSERT cost is estimated.
6. **Redis dedup round-trip for view capture not measured** — I measured the DB UPDATE only (the contended part).
7. **Frontend analytics wiring / external warehouse** — out of scope (none exists in-repo).

---

## 1 · Топ по цене (path · N · ms · план)

| # | Горячий путь | N (названная нагрузка) | ms (warm) | План | Масштабирование |
|---|---|---|---|---|---|
| A | **Saved-search matcher** `findMatches` (per activated listing) | 1 000 saved_searches | **0.9 ms** | **Seq Scan** + quicksort | **линейно O(S)** — нет индекса под `filters->>` |
| A | ″ | 10 000 saved_searches | **6.5 ms** | **Seq Scan** (Rows Removed 7 300) + top-N heapsort | → 100k ≈ 65 ms/событие |
| B1 | **Discovery non-geo** (default feed, `market=pet` ACTIVE) | 1 000 active (500 pet) | **3.7 ms** | Bitmap idx_listings_market_status + top-N sort | **линейно O(active-pet)** — нет covering-индекса под ORDER BY created_at |
| B1 | ″ | 10 000 active (5 000 pet) | **7.0 ms** | Index Scan idx_listings_status, Rows Removed 5 000, top-N sort | → 100k pet ≈ 70 ms/страница + такой же COUNT |
| B2 | **Discovery geo** (bbox+Haversine, r=100 km) | 1 000 active | **1.3 ms** | BitmapAnd(market_status × latlng) | **сублинейно** — bbox отсекает, ХОРОШО |
| B2 | ″ | 10 000 active | **1.6 ms** | BitmapAnd, Heap Blocks 82 | геопуть индексирован верно |
| C1 | **Moderation queue — PAGE** (LIMIT 20) | 10 000 pending | **0.86 ms** | idx_listings_modqueue short-circuit (33 rows) | **flat** — индекс держит ORDER BY, ХОРОШО |
| C2 | **Moderation — COUNT(*)** (без LIMIT) | 1 000 pending | **5.6 ms** | Hash Join l⋈animals⋈species, **Seq Scan animals** | **линейно O(N_pending)** |
| C2 | ″ | 10 000 pending | **17.9 ms** | тот же 3-table join, весь base CTE | → на flood растёт неограниченно |
| C3 | **Moderation — GROUP BY market/sla** (×2, без LIMIT) | 10 000 pending | **18.9 ms** каждый | HashAggregate поверх того же 3-table join | ×2 на страницу |
| D | **view_count increment** (в GET-пути, `await`) | 16 клиентов → 1 строка | **12.2 ms** avg, **1310 TPS** | Update по listings_pkey, **row-lock serialization** | **hot-row: ×4 медленнее** spread (3.1 ms / 5168 TPS) |

**Итог одной страницы очереди модерации @ 10 000 pending ≈ 0.86 + 17.9 + 18.9 + 18.9 ≈ 56 мс**, из которых
99 % — три unbounded-агрегата, каждый переигрывающий трёхтабличный join, которому нужен **только `listings`**.

---

## 2 · Детально по каждому пути

### A · Saved-search matcher — Seq Scan, нет индекса, квадратичность под потоком

`saved-search-match.consumer.ts:186` `findMatches` → `matchSql:226`. Единственный индекс на таблице —
`idx_saved_searches_user(user_id)` (schema:434). Предикат целиком на **JSONB-выражениях** `s.filters->>'market'`,
`(s.filters->>'species_id')::int`, `s.offering_type`, `s.radius_m` + Haversine — **ни одно не индексируемо** без
выражательного/GIN-индекса, которого нет. Отсюда **полный Seq Scan на каждую активацию листинга**:

```
N=1000 : Seq Scan on saved_searches (actual time=0.026..0.755 rows=270)  Execution Time: 0.96 ms
N=10000: Seq Scan on saved_searches (actual time=0.014..5.645 rows=2700) Execution Time: 6.46 ms
         Rows Removed by Filter: 7300
```

Линейно: ×10 данных → ×6.7 времени. **Квадратичность под потоком:** relay обрабатывает активации
последовательно на воркере; поток из A активаций против S сохранённых поисков = **A × O(S)** только на скан.
На 100k saved_searches ≈ 65 мс/событие; всплеск одобрений (модерация APPROVE→ACTIVE пачкой) сериализуется
на одном воркере.

**Фан-аут усугубляет.** При N=10 000 один pet-листинг совпал с **2 700** поисками. `MAX_MATCHES_PER_LISTING=500`
(consumer.ts:11) → цикл `for (const m of matches)` с `await this.writer.materialize` **последовательно** до 500
раз (INSERT в `notification_logs` + транзакционный INSERT `SavedSearch.Matched` в outbox на каждую пару). При
базовой стоимости одного round-trip ~1–3 мс (см. D) популярная активация = **сотни мс–секунда** серийных
INSERT-ов + до **1 000 строк** (500 notif + 500 outbox-событий) на одно событие.

**Побочный дефект справедливости (не только цена):** `ORDER BY s.created_at ASC LIMIT 500` — при >500 совпадений
алертятся **только 500 самых старых** поисков; новые систематически голодают на «популярных» листингах, и это
видно лишь по `logger.warn` (consumer.ts:94). То есть закон отсечения — детерминированно против новичков.

**Образец запроса:** `scratchpad/match_query.sql` (дословный перенос matchSql с конкретными bound-значениями
pet-листинга: market='pet', species_id=1, breed_id=102, price=12000, lat=50.77, lng=32.64).

---

### B · Discovery `GET /listings` (`listing.service.ts:918` `listDiscovery`)

**B1 non-geo (дефолтная лента — самый частый запрос).** Anon-браузинг `market=pet` + `status=ACTIVE`
(`listScopeSql:1102`). **Нет индекса под `(market, status, created_at DESC)`** — доступны только
`idx_listings_market_status(market,status)`, `idx_listings_status(status)`, ни один не даёт порядок `created_at`.
Планировщик читает **всю** партицию active-pet и делает top-N heapsort:

```
N=1000  active: Bitmap idx_listings_market_status → 500 pet rows → top-N sort  Execution Time: 3.68 ms
N=10000 active: Index Scan idx_listings_status → 5000 pet rows (Rows Removed 5000) → top-N sort  7.51 ms
```

Линейно по объёму active-инвентаря. На 100k pet-листингов ≈ 70 мс на страницу — **плюс отдельный `COUNT(*)`**
(`listing.service.ts:993`), который сканирует тот же набор ещё раз каждый запрос. Глубокая OFFSET-пагинация
читает OFFSET+LIMIT после полной сортировки → deep-page деградирует дополнительно (не замерял, структурно следует).
Планировщик **менял выбор индекса между масштабами** (1k → market_status bitmap; 10k → status index) — оба
всё равно сканируют всю партицию; это не спасение, а признак отсутствия направляющего индекса.

**B2 geo — построено верно.** bbox-предфильтр (`bboxSql:1080`, использует `idx_listings_latlng`) + точный
Haversine как HAVING. BitmapAnd отсекает до ~590 строк, Haversine считается только на выживших:

```
N=10000: BitmapAnd(idx_listings_market_status × idx_listings_latlng) → 590 rows → Haversine → sort  1.6 ms
```

Сублинейно, **claim о ценах на гео подтверждён здоровым**. **Образцы:** `scratchpad/disco_nogeo.sql`,
`scratchpad/disco_geo.sql`.

---

### C · Moderation queue CTE (`moderation.service.ts:180` `queueBaseCte`, `:126` getQueue)

Одна загрузка страницы очереди = **4 исполнения CTE**: page (LIMIT 20) + total COUNT + GROUP BY market +
GROUP BY sla_state (`moderation.service.ts:126–151`).

- **PAGE — здоров.** `idx_listings_modqueue(moderation_enqueued_at) WHERE status='PENDING_MODERATION'`
  (schema:1602) отдаёт порядок `moderation_enqueued_at ASC` напрямую; LIMIT 20 короткозамыкает после
  ~33 nested-loop-строк. **0.86 мс @ 10 000 pending, flat.**
- **COUNT + 2×GROUP BY — дорого и с мёртвым весом.** У них нет LIMIT → материализуют **весь** base CTE:

```
COUNT(*)      @10000: Hash Join l⋈animals(Seq Scan 20000)⋈species  Execution Time: 17.9 ms
GROUP BY market @10000: HashAggregate поверх того же join            Execution Time: 18.9 ms
COUNT(*)      @1000 :                                                Execution Time:  5.6 ms
```

Линейно по N_pending. **Мёртвый вес:** COUNT и GROUP BY market/sla **не нуждаются ни в чём из animals/species** —
`species.code` нужен только для *display* в PAGE, а `market` уже кэширован на `listings.market` (D3/ADR-0018),
`sla_state` считается из `moderation_enqueued_at`/`locked_at`/`market` (всё на listings). То есть трёхтабличный
join тащится в 3 из 4 запросов зря; COUNT по одному `listings` с `idx_listings_modqueue` был бы ~суб-мс.

**Связка с trust-and-safety (AUDIT4 T2):** POST /listings без rate-limit → очередь PENDING растёт неограниченно →
каждая перерисовка дашборда модерации стоит **O(N_pending)×(3-table join)** ровно тогда, когда нужно осушать
flood. Дешёвый инструмент замедляется под нагрузкой, которую он призван разгребать. **Образцы:**
`scratchpad/modqueue.sql`, `modcount.sql`, `modgroup.sql`.

---

### D · view_count increment — синхронный write на одну спорную строку в GET-пути

`listing.service.ts:283` `await this.captureView(...)` → `:312` `UPDATE listings SET view_count = view_count+1
WHERE id=$1`. Redis-dedup (30-мин окно на зрителя, `:310`) отсекает повтор *одного* зрителя, но **много разных
зрителей одного вирусного листинга** одновременно → все инкременты сериализуются на row-lock одной строки:

```
pgbench, 16 клиентов, 6 c:
  HOT   (все → одна строка):    tps=1310, latency avg 12.2 ms
  SPREAD(каждый → случайная):   tps=5168, latency avg  3.1 ms
```

**×4 потеря пропускной и ×4 латентности** на спорной строке. Инкремент **`await`-ится внутри** `getById`
(комментарий `:281` «Awaited but fully error-swallowed» — ошибка глотается, но чтение ЖДЁТ write). Значит
`GET /listings/{id}` вирусного листинга платит ~12 мс row-lock-ожидания — **чем популярнее листинг, тем медленнее
его страница**, ровно для популярного. Плюс повтор апдейтов одной строки = версии строки/bloat до автовакуума.
Смягчение: буфер инкрементов (INCR в Redis → периодический flush), либо не-`await` (fire-and-forget), либо
off-row счётчик (Option C, зарезервирован миграцией 0035 «за этим seam»). **Образцы:** `scratchpad/hot.sql`,
`spread.sql`.

---

## 3 · Метрики и событийная модель

### 3.1 North-star (frequency × breadth) — сколько инструментируемо СЕГОДНЯ

**view_count живой (D1)?** — Да. Колонка `listings.view_count` (миграция 0031), инкремент в `captureView`,
`getAnalytics.views = Number(row.view_count)` (`listing.service.ts:841`). Но это **кумулятивный скаляр без оси
времени** — читается lifetime-тотал, **нельзя** построить views-over-time, daily-unique, view→reveal-когорту.
Для B9 «counts + series-ready» — половина: counts ✓, series ✗.

**Оценка инструментируемости входных сигналов North-star** (frequency-ось = как часто происходят ценностные
события; breadth-ось = охват участников/рынков/потребностей):

| Сигнал North-star | Эмиссия | Потребитель | Series-queryable СЕГОДНЯ | Откуда |
|---|---|---|---|---|
| Просмотры (верх воронки) | — (скаляр) | — | ❌ **только тотал** | `listings.view_count` — нет timestamp |
| Contact reveals (спрос-интент) | `ContactReveal.Created` | **0** | ✅ серия | `contact_reveals.created_at` (durable-таблица) |
| Self-marked sale (очистка предложения) | `Listing.Sold` | **0** | ✅ серия | `listings.sold_at` (но самозаявленный, low-confidence — AUDIT4) |
| Verified sale (доказанная сделка) | `ConfirmedSale.Confirmed` | **0** | ✅ серия | `confirmed_sales.created_at` (durable, transfer-anchored) |
| Saved-search match (возврат спроса) | `SavedSearch.Matched` | **0** | ❌ **только outbox JSONB** | нет таблицы-проекции |
| Регистрации (acquisition) | — (не эмитится) | — | ✅ серия | `users.created_at` напрямую |
| Breadth: рынок pet/livestock | — | — | ✅ | `market` кэширован везде (ADR-0002) |
| Breadth: домохозяйство | — | — | ❌ | нет household-модели (AUDIT4) |
| Breadth: доля потребностей | — | — | ❌ | нет needs-таксономии → **share-of-needs не считать, будет выдумкой** |

**Вердикт числом.** Из ~6 сырых сигналов frequency-оси **3 (reveals, self-sale, confirmed-sale) + регистрации
= series-queryable из durable-таблиц** bespoke-SQL-ом; **view_count — только тотал** (единственный верх-воронки
сигнал без оси времени, и его нельзя добэкфиллить); **SavedSearch.Matched — только в outbox** (нет проекции).
Breadth-ось: **рынок полон, домохозяйство/потребности отсутствуют**. Ключевое: **0 % ценностных событий
материализовано в аналитическую проекцию** — нет ни одного consumer'а для value-стрима, поэтому **каждое число
North-star — живой скан продакшн-таблиц** (а `SavedSearch.Matched` — скан JSONB payload в `outbox_events`).

Грубо: *frequency-ось ≈ 60–70 % инструментируема как серии из durable-таблиц; breadth-ось рыночно-полна, но
needs-слепа; аналитический слой проекций = 0 % (всё bespoke-сканы)*.

### 3.2 Событийная модель: эмиссия vs каталог vs потребители

**Эмитируется (9 типов, grep `eventType:`):** `Moderation.Decided`, `Listing.Activated`, `Moderation.Escalated`,
`Listing.Sold`, `ContactReveal.Created`, `OwnershipTransfer.{Initiated,Accepted,Declined,Cancelled,Expired}`,
`ConfirmedSale.Confirmed`, `SavedSearch.Matched`.

**Потребители (ровно 2):**
- `NotificationConsumer` → `Moderation.Decided` + 5×`OwnershipTransfer.*` (registry, `notification.registry.ts`).
- `SavedSearchMatchConsumer` → `Listing.Activated`.

**Мёртвые сигналы (эмиссия есть, 0 потребителей):** `Listing.Sold`, `ContactReveal.Created`,
`ConfirmedSale.Confirmed`, `SavedSearch.Matched`, `Moderation.Escalated`. Для трёх из них ДАННЫЕ не потеряны —
их дублирует durable-таблица (`listings.sold_at`, `contact_reveals`, `confirmed_sales`); мёртв только event-стрим.
**`SavedSearch.Matched` — единственный без таблицы-тени** → живёт исключительно в `outbox_events` (который
никогда не чистится, AUDIT4), и фан-аут матчера множит его до 500/активацию → **быстро раздувает непрочищаемый
outbox_events без единого читателя**.

- **SavedSearch.Matched — есть эмиссия, есть потребитель?** Эмиссия ✅ (`consumer.ts:124`, транзакционно с
  notif-INSERT, exactly-once по ON CONFLICT). **Потребителя — НЕТ.** Кормит будущую воронку match→view→contact,
  сегодня — мёртвый (и дорогой: см. фан-аут в §2A).
- **ConfirmedSale.Confirmed — есть эмиссия, есть потребитель?** Эмиссия ✅ (`transfer.service.ts:767`, в tx с
  auto-CONFIRMED вставкой). **Потребителя — НЕТ.** Но `confirmed_sales` durable → доказанная сделка queryable
  напрямую (это лучший, verified value-сигнал для North-star; просто не потребляется как событие).

**Дрейф каталога (event-catalog.md).** Каталогизировано, но **не эмитится**: `Listing.Submitted`,
`Listing.Deactivated`, `Listing.Expired`, `User.Registered`, `ConfirmedSale.{Created,Disputed,Expired}`,
`Payment.{Completed,Failed}`. Часть легально зарезервирована (Payment — Phase-2 gated; ConfirmedSale-lifecycle —
FORM-only). Но `Listing.Submitted/Deactivated/Expired` и `User.Registered` в каталоге как существующие при нулевой
эмиссии = **аспирационный каталог**: карта событий обещает то, чего в коде нет.

---

## 4 · Дефекты (severity · антарая · образец)

По правилу остановки (03.08): блокирует только **тихий отказ** и **вред, видимый владельцу**. Ниже — латентные
цены масштаба; на MVP-нагрузке (1k–10k) все <20 мс, потому **ни один не BLOCKER**. Ранжировано по decision-value.

**D-1 · MAJOR · view_count contention в GET-пути.** `авирати (проверка не доведена до боевого режима «много
разных зрителей одного листинга»)`. `listing.service.ts:283,312`. Hot-row 12.2 мс/1310 TPS vs spread 3.1 мс/5168
TPS (×4), и write `await`-ится внутри чтения → страница популярного листинга медленнее ровно из-за популярности.
Образец: `scratchpad/hot.sql` vs `spread.sql`. Fix: буфер (Redis INCR→flush) / fire-and-forget / off-row счётчик
(seam 0035).

**D-2 · MAJOR · Moderation COUNT/GROUP BY тащат мёртвый 3-table join, O(N_pending).** `аласья (короткий путь:
единый base CTE переиспользован во всех 4 запросах вместо тощего COUNT)`. `moderation.service.ts:126–151,180`.
17.9 мс COUNT + 18.9×2 GROUP BY @10k pending ≈ 55 мс/страница; join к animals/species не нужен ни COUNT'у, ни
GROUP BY (market на `l.market` D3, sla из listings). Усиливается listing-flood (AUDIT4 T2). Образец:
`scratchpad/modcount.sql`. Fix: COUNT/GROUP BY по одному `listings` (+`idx_listings_modqueue`), join только в PAGE.

**D-3 · MAJOR · Saved-search matcher: Seq Scan без индекса + квадратичность под потоком + фан-аут.** `самшая
(цена пути не была названа числом — «decoupled worker, ok» без замера) · стьяна (SavedSearch.Matched —
эмитируемое событие без потребителя, декоративный сигнал, множимый ×500 в непрочищаемый outbox)`.
`saved-search-match.consumer.ts:186,226`; schema:434 (только idx на user_id). 0.9 мс@1k → 6.5 мс@10k линейно; поток
активаций = A×O(S); популярная активация = до 500 серийных INSERT + 1000 строк. Образец: `scratchpad/match_query.sql`.
Fix: выражательные/GIN-индексы под market/species/breed предикаты ИЛИ материализованный обратный индекс; батч-INSERT
фан-аута; поднять/пагинировать cap 500.

**D-4 · MAJOR · Discovery non-geo (дефолтная лента): нет covering-индекса под `(market,status,created_at DESC)`.**
`самшая (частая лента не замерена на объёме, «индексы есть» без проверки порядка)`. `listing.service.ts:918,993`.
3.7 мс@1k → 7 мс@10k линейно по active-инвентарю + отдельный полный COUNT каждый запрос; deep-OFFSET деградирует
дополнительно. Образец: `scratchpad/disco_nogeo.sql`. Fix: индекс `listings(market, status, created_at DESC)`
(частичный WHERE status='ACTIVE') → keyset/seek-пагинация вместо OFFSET.

**D-5 · MINOR · Фан-аут matcher отсекает по `created_at ASC LIMIT 500` — новые saved-searches голодают.**
`анавастхитатва (правило справедливости не удержано: при >500 совпадений новички систематически не алертятся)`.
`consumer.ts:91,192`. Не цена — корректность/справедливость демонд-лупа; видно только по WARN-логу. Fix: сделать
отсечение честным (пагинация фан-аута / приоритет по релевантности, не по возрасту поиска).

**D-6 · MINOR · Дрейф event-catalog: 4 события каталогизированы, но не эмитятся.** `бхранти-даршана (карта
событий мерит не то, что есть — обещает Listing.Submitted/Deactivated/Expired, User.Registered при нулевой
эмиссии)`. `docs/specs/event-catalog.md`. Не цена; гигиена карты сигналов, чтобы аналитик не строил метрику на
несуществующем событии. Fix: пометить аспирационные как `(reserved / not-yet-emitted)`.

**D-7 · INFO · 0 потребителей value-стрима → нет аналитической проекции.** `стьяна (событийный слой объявлен,
но по value-событиям бездействует — каждая метрика это bespoke-скан)`. Подтверждение AUDIT4 против HEAD: 5 value-
событий без consumer; данные спасены durable-таблицами (кроме SavedSearch.Matched). Fix: append-only
`analytics_events`-проекция (catch-all valueEvent) ДО любого purge outbox; иначе поздний consumer не увидит
историю (replay-слепота, processed_at-фильтр).

---

## 5 · Что здорово (подтверждено числом, не хвалю на глаз)

- **Гео-поиск** (B2): bbox-предфильтр через `idx_listings_latlng` + Haversine только на выживших → 1.6 мс@10k,
  сублинейно. Спроектировано правильно.
- **Очередь модерации — PAGE** (C1): `idx_listings_modqueue` короткозамыкает ORDER BY+LIMIT → 0.86 мс@10k, flat.
- **ADR-0002 разделение рынков** держится структурно во всех горячих путях (кэш `listings.market` D3; matcher
  анкерит market/species/breed — cross-market leak невозможен).
- **view_count дедуп** (Redis NX 30-мин) корректно гасит спам одного зрителя; проблема D-1 — только про многих
  РАЗНЫХ одновременных зрителей.

---

*Ephemeral PG torn down after measurement. Host PG untouched. No product code/docs changed.*
