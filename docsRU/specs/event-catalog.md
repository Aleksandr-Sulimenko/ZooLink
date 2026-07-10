---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Спецификация: Каталог доменных событий и контракт outbox-relay

## Результат
Сделать событийные швы реализуемыми. Определяет (1) **контракт дренажа outbox** (как вычитывается `outbox_events`),
(2) **каталог событий MVP** (какие события пишет каждый producer и кто consumer), (3) маппинг
**событие → нотификация**. Без этого разработчик не построит воркер (ADR-0009) и поток уведомлений.

## 1. Контракт outbox-relay
- **Producer:** в той же транзакции БД, что меняет агрегат, домен пишет строку в
  `outbox_events(aggregate_type, aggregate_id, event_type, payload)` (transactional outbox — атомарно с изменением).
- **Relay:** фоновый `worker` (ADR-0009) опрашивает `outbox_events WHERE processed_at IS NULL`
  (индекс `idx_outbox_unprocessed`) каждые `OUTBOX_POLL_MS` (по умолчанию 1000 мс), по `created_at`, батчами.
  Опционально будится `pg_notify('outbox', ...)`. После успеха consumer выставляет `processed_at = now()`.
- **Семантика доставки:** **at-least-once.** Consumers ОБЯЗАНЫ быть **идемпотентны** (ключ по `outbox_events.id`
  или естественный idempotency-key). Упавший хендлер оставляет `processed_at` NULL → ретрай с экспоненциальным
  backoff; после `OUTBOX_MAX_ATTEMPTS` (по умолч. 10) строка паркуется (+алерт) для ручного разбора.
- **Порядок:** порядок по `aggregate_id` сохраняется последовательной обработкой событий одного агрегата.
- **Конверт payload:** JSONB; каждый payload несёт поля конверта `schemaVersion` (число; инкремент при изменении
  формы payload), `occurredAt` (время доменного события, ISO-8601) и `market` (`pet`|`livestock` по ADR-0002 либо
  `null` для событий вне рынка) рядом с доменными полями. `aggregate_id` и id строки (id события) — колонки
  `outbox_events`. Ключи конверта в `camelCase` (соглашение API); их проставляет writer `OutboxService.publish`,
  поэтому продюсер не может их пропустить.

> **(round-N, normative — конверт события `market`/`schemaVersion`/`occurredAt`, аудит 2026-06-30) WHAT:** обязательный
> конверт payload теперь явно перечисляет `schemaVersion`, `occurredAt` и **`market`** (последнего ранее не было),
> фиксирует `camelCase` и централизованную простановку в outbox-writer.
> **WHY:** консьюмерам аналитики/уведомлений (и метрикам здоровья маркетплейса по рынкам в Part B) нужен `market`
> в каждом событии без повторного join к species; захват с первого события делает историю атрибутируемой.
> `schemaVersion`/`occurredAt` уже подразумевались §1, но не были обеспечены в коде.
> **WHY-BETTER-for-the-whole-project:** единый конверт, проставляемый writer'ом, исключает дрейф продюсеров,
> сохраняет разделение рынков ADR-0002 в потоке событий и делает отложенных консьюмеров чистым дополнением —
> в день регистрации они читают полный конверт. EN-канон обновлён.

## 2. Каталог событий MVP

| event_type | aggregate_type | Producer | Payload (ключевое) | Consumers (действие) |
|---|---|---|---|---|
| `Listing.Submitted` | Listing | listing (DRAFT→PENDING_MODERATION) | listing_id, seller_id | moderation (в очередь) |
| `Moderation.Decided` | Listing/Animal | moderation | entity_type, entity_id, decision, reason | listing (применить статус), **notification (уведомить владельца)** |
| `Moderation.Escalated` | Listing | moderation **SLA-job** (worker) | entityId, market, waitingSeconds, slaState | **notification (уведомить ADMIN)**. Emit-only в 4c (admin fan-out — это notification-consumer). Job **никогда** не меняет `status`/`moderation_status` — элемент остаётся PENDING_MODERATION (M-13). **Идемпотентно:** эмитится **один раз** на просроченный элемент (маркер `listings.escalated_at`, ставится в той же tx, что и outbox-запись); сбрасывается при re-enqueue (M-14/4d). |
| `Listing.Activated` | Listing | listing (→ACTIVE) | listing_id, seller_id | search-index (опубликовать), notification |
| `Listing.Expired` | Listing | worker (истёк срок) | listing_id, seller_id | search-index (убрать), **notification** |
| `Listing.Sold` | Listing | listing (владелец отметил продано, MVP) | listing_id, seller_id, **offeringType, offeringId** (v2) | search-index (убрать), notification |
| `Listing.Deactivated` | Listing | listing/moderation | listing_id, reason | search-index (убрать), notification (если удалил модератор) |
| `User.Registered` | User | identity | user_id | notification (welcome/verify — SMS инлайн) |
| `ContentReport.Filed` | ContentReport | moderation | report_id, entity_type, entity_id | moderation (в очередь) |
| `ContentReport.Actioned` | ContentReport | moderation | report_id, target, action | listing (деактивировать цель), **notification (репортёру+владельцу)** |
| `ContactReveal.Created` | Listing | contact | listing_id, viewer_id, seller_id, **offeringType, offeringId** (v2) | analytics/counter (rate-limit + статистика владельца) |
| `SavedSearch.Matched` | SavedSearch | worker нотификаций (`SavedSearchMatchConsumer`, в по-парной выигравшей INSERT-tx) | savedSearchId, listingId, subjectUserId, market, matchedAt | **пока нет** (только аналитика; dormant). Позже: воронка спроса match→view→contact (data-analyst). Эмитится **ровно один раз на пару (saved_search, listing)** — только когда строка алерта реально вставлена (согласовано с SS-M4). |
| `OwnershipTransfer.Initiated` | OwnershipTransfer | animal/transfer (T1) | transferId, animalId, fromUserId, fromOrganizationId, toUserId, toOrganizationId | **notification (получателю)** |
| `OwnershipTransfer.Accepted` | OwnershipTransfer | animal/transfer (T2) | (как выше) | **notification (инициатору)** |
| `OwnershipTransfer.Declined` | OwnershipTransfer | animal/transfer (T3) | (как выше) | **notification (инициатору)** |
| `OwnershipTransfer.Cancelled` | OwnershipTransfer | animal/transfer (T4) | (как выше) | **notification (получателю)** |
| `OwnershipTransfer.Expired` | OwnershipTransfer | animal/transfer (T5, ленивое истечение) | (как выше) | **notification (ОБЕИМ сторонам)** |
| `ConfirmedSale.Confirmed` | ConfirmedSale | animal/transfer (accept, в той же tx) | confirmedSaleId, anchorType, ownershipTransferId, animalId, offeringType, offeringId, sellerUserId/OrganizationId, buyerUserId/OrganizationId, status | **пока нет** (спящий захват; ADR-0038 §3). Позже: открыватель окна отзывов, notification, аналитика |
| `ConfirmedSale.Created` | ConfirmedSale | listing markSold (отложено, `sale_buyer_confirmation`) | (как выше; anchor=`LISTING_MARK_SOLD`) | **зарезервировано** — эмитится при записи строки PENDING_CONFIRMATION (путь номинации покупателя). НЕ эмитится с якоря передачи (нет фазы PENDING). |
| `ConfirmedSale.Disputed` | ConfirmedSale | слайс поведения репутации (отложено) | (как выше; status=`DISPUTED`) | **зарезервировано** — очередь модерации (ADR-0040), аналитика |
| `ConfirmedSale.Expired` | ConfirmedSale | свипер истечения подтверждения (отложено) | (как выше; status=`EXPIRED`) | **зарезервировано** — аналитика (слабый сигнал); **никогда** не открывает окно отзывов |
| `Payment.Completed` / `Payment.Failed` | Payment | payment | **Фаза 2+ (гейт `feature_toggles.payments`)** | listing (SOLD), notification |

> Producer/consumer — это **модули внутри монолита** (ADR-0009), не микросервисы. «Consumer» = in-process хендлер,
> подписанный на ретранслированное событие.

> **(round-N, нормативно — полиморфный субъект value-события, ADR-0018 §Amendment D5 / seam OfferingRef ADR-0014) ЧТО:** value-события `Listing.Sold` и `ContactReveal.Created` теперь несут в payload `offeringType` (enum, по умолчанию `ANIMAL_LISTING`) и `offeringId` (id субъекта; == `listing_id` для `ANIMAL_LISTING`), а их `schemaVersion` поднят **1 → 2** (изменение формы payload по §1). **ПОЧЕМУ:** аналитическая/маркетплейс-воронка должна со временем охватывать *все* подтипы offering (услуги, товары, экспертиза — ADR-0014), а не только листинги животных; без дискриминатора субъекта на value-событиях будущий тип offering был бы невидим воронке либо потребовал бы ломающего переписывания события. **ЧЕМ ЛУЧШЕ:** добавление чисто аддитивно (существующие consumer'ы продолжают читать `listingId`/`sellerId`); consumer нотификаций (ADR-0021) не подписан на эти два типа событий (его реестр — allow-list `OwnershipTransfer.*`), поэтому bump ничего не ломает; и это зеркалит seam OfferingRef из D2 на `favorites`/`saved_searches` — единая форма полиморфного субъекта на всей платформе, зарезервированная дёшево сейчас, а не мигрируемая под нагрузкой позже.

## 3. Матрица событие → нотификация
Уведомления шлёт **модуль notification как consumer ретранслированного события** (не прямыми вызовами).
Каждая строка ссылается на `notification_templates(name, type, language)` (seed в миграции).

| Событие | Канал | Шаблон | Получатель |
|---|---|---|---|
| `User.Registered` | SMS | `user_verify_code` | пользователь |
| `Moderation.Decided` = APPROVED | email | `listing_approved` | продавец |
| `Moderation.Decided` = REJECTED | email | `listing_rejected` | продавец |
| `Moderation.Decided` = CHANGES_REQUESTED | email | `listing_changes_requested` | продавец |
| `Listing.Expired` | email | `listing_expired` | продавец |
| `ContentReport.Actioned` | email | `report_resolved` | репортёр (+ владелец, если удалено) |
| `Moderation.Escalated` | email | `moderation_sla_escalated` | ADMIN (очередь эскалаций) |
| `OwnershipTransfer.Initiated` | in-app | `transfer_initiated` | получатель |
| `OwnershipTransfer.Accepted` | in-app | `transfer_accepted` | инициатор |
| `OwnershipTransfer.Declined` | in-app | `transfer_declined` | инициатор |
| `OwnershipTransfer.Cancelled` | in-app | `transfer_cancelled` | получатель |
| `OwnershipTransfer.Expired` | in-app | `transfer_expired` | обе стороны |
| `Listing.Activated` → совпадение сохранённого поиска | in-app | `saved_search_matched` | владелец каждого совпавшего сохранённого поиска (одна строка на пару (saved_search, listing)) |

> **(round-N, нормативно — события ownership-transfer + первый `IN_APP`-consumer, ADR-0021, C4) WHAT:**
> добавлены события `OwnershipTransfer.{Initiated,Accepted,Declined,Cancelled,Expired}` (агрегат —
> OwnershipTransfer) в §2 и их `IN_APP`-маршруты в §3; зафиксировано, что модуль notification теперь —
> **реальный** consumer (канал `IN_APP`), а не заглушка. Сервис передачи публикует каждое событие в **той
> же транзакции**, что и смену состояния; получатель — «другая сторона» относительно действующего (при
> системном истечении — обе). **WHY:** исходы передачи владения производились, но были «немыми» (нет
> consumer), а сами события не были в каталоге — по §2/§3 нельзя было построить ни их эмиссию, ни
> нотификацию. ADR-0021 делает `IN_APP` MVP-каналом (без провайдера и согласия — транзакционные ≠ реклама,
> ФЗ-38). **WHY-BETTER-для-всего-проекта:** заканчивает «немой слой событий» для двух ключевых потоков
> (модерация + передача) минимальным обратимым изменением; consumer на реестре остаётся Offering-ready
> (ADR-0014); forward-only replay (реле `WHERE processed_at IS NULL`) — корректная спам-безопасная
> семантика, а запрет очистки outbox сохраняет возможность backfill для аналитики. EN-оригинал обновлён.

> **(round-N, нормативно — `Moderation.Escalated`, Slice 4c) WHAT:** добавлено событие
> `Moderation.Escalated` (aggregate = Listing) в каталог + матрицу нотификаций. SLA-job модерации сканирует
> элементы `PENDING_MODERATION` за порогом SLA и эмитит его через outbox; ставит
> `listings.escalated_at` (в **той же** tx, что и outbox-запись), так что re-tick не пере-эмитит.
> Consumer = notification → ADMIN.
> **WHY:** SLA-эскалация уже была нормативной в спеке модерации (§SLA, `slaState=ESCALATED`),
> и D1-реконсиляция убрала старое авто-отклонение, но **событие**, несущее эскалацию
> к ADMIN, отсутствовало в каталоге — разработчик не мог построить эмиссию job по §2.
> **WHY-BETTER-for-the-whole-project:** держит эскалацию чисто **read-side, аддитивным** сигналом — job
> никогда не меняет `status`/`moderation_status` (M-13: элемент остаётся PENDING_MODERATION, никогда не авто-
> решён), так что он не может навредить листингу; `escalated_at` даёт at-least-once-safe **once-per-item**
> эмиссию, согласованную с правилом идемпотентного consumer'а outbox (§1); admin fan-out переиспользует
> существующий notification-consumer-паттерн (без нового транспорта). Сейчас emit-only; активный сброс при
> re-enqueue отложен на M-14/4d (которая владеет переходом ACTIVE→PENDING re-moderation).

> **(round-N, нормативно — channel ≠ source; allow-list реестра сверен, Slice H3 / ADR-0021 §Поправка 2026-07-08) WHAT:** два уточнения к матрице выше, ни одна строка не удалена. **(a) Канал против источника.** MVP-**канал** доставки — `IN_APP` для каждого события, которое потребитель маршрутизирует сегодня; колонка `Channel(s)` выше называет *конечный/целевой* транспорт, а колонка `Template name` называет строку-**источник** `notification_templates`, засеянную как `type=EMAIL`. Построенный `NotificationConsumer` рендерит IN_APP-уведомление **из этой EMAIL-строки-источника** — *channel ≠ source*: EMAIL-типизированный шаблон — это происхождение контента, материализованная строка `notification_logs` имеет channel `IN_APP` (читается через `GET /v1/me/notifications`). **(b) Реестр — это allow-list.** `NOTIFICATION_REGISTRY` потребителя сегодня содержит **только** `Moderation.Decided` (→ продавцу) и `OwnershipTransfer.{Initiated,Accepted,Declined,Cancelled,Expired}`. Остальные каталогизированные строки — `Listing.Expired` / `Listing.Sold` / `Listing.Activated` и `ContentReport.Actioned` — **каталогизированы-но-отложены**: пока нет записи реестра / засеянного шаблона, поэтому применяется путь relay «нет подходящего потребителя → пометить обработанным», и они не уведомляют. Они остаются в матрице как **цель**, отслеживаются в ADR-0021 §Поправка. **WHY:** до этого примечания матрица читалась так, будто все строки живы и часть доставляется через `email`, но построенная реальность — только IN_APP для набора Moderation+Transfer; читатель/агент не мог отличить обещанное от построенного, ни понять, что EMAIL-шаблон — это *источник контента*, а не живой email-канал. **WHY-BETTER-for-the-whole-project:** это делает каталог правдивым контрактом (построенное против отложенного явно, с путём закрытия), сохраняет обещание покрытия как цель вместо его обрезки, и держит *channel ≠ source* читаемым, чтобы будущий slice провайдера EMAIL/SMS переиспользовал те же строки-шаблоны без изменения схемы. EN-оригинал обновлён.

> **(round-N, нормативно — `Listing.Activated` получает ПЕРВЫЙ живой consumer: алерты по сохранённым поискам, Slice H4 / AUDIT4 возврат со стороны спроса) WHAT:** `Listing.Activated` (уже эмитится в той же tx при модерации APPROVE→ACTIVE) теперь имеет **живой** worker-consumer `SavedSearchMatchConsumer` — **второй** элемент в списке `OUTBOX_CONSUMERS`, ОТЛИЧНЫЙ от реестрового `NotificationConsumer`. На каждый `Listing.Activated` он сопоставляет ставший активным листинг с `saved_searches` пользователей (`offering_type='ANIMAL_LISTING'`) и материализует одно IN_APP-уведомление `saved_search_matched` на каждую совпавшую пару **(saved_search, listing)**, отрендеренное из EMAIL-строки-источника, засеянной миграцией 0037 (*channel ≠ source*, как и для любой другой IN_APP-строки). Это **отменяет** классификацию из примечания H3, где `Listing.Activated` был «каталогизирован-но-отложен»: исходный реестровый маршрут строки `notify owner` остаётся отложенным, но `Listing.Activated` больше не без-consumer'ный — он теперь запускает алерт со стороны спроса. **Дедуп:** `idempotency_key` уведомления — детерминированное по-парное значение `saved_search_matched:<savedSearchId>:<listingId>`, так что at-least-once повторная доставка `Listing.Activated` схлопывается ровно в одну строку на пару — ни событие `SavedSearch.Matched`, ни колонка-маркер «уведомлён» на листинге не нужны. **Подмножество сопоставления (документировано, честно):** равенство `market`/`species_id`/`breed_id`/`listing_type`, границы `price_min`/`price_max` (листинг без цены никогда не совпадёт с поиском с ценовой границей) и гео-`radius_m` (точный Haversine); **`q` свободный текст НЕ вычисляется** (нет дешёвого однозначного серверного полнотекста по локализованному JSONB — поиск с `q` всё равно совпадает по остальным фильтрам). **ADR-0002 (жёсткое разделение рынков):** поиск совпадает ТОЛЬКО когда он привязан к рынку листинга (пинит `market` == рынку листинга, ЛИБО пинит `species_id`/`breed_id`, которые живут ровно в одном рынке и должны равняться значениям листинга); полностью безрыночный поиск (нет якоря market/species/breed) намеренно **не** сопоставляется, поэтому алерт не может пересечь pet↔livestock. Продавец никогда не получает алерт о собственном листинге. **Предпочтения:** алерт по сохранённому поиску — это ЗАПРОШЕННОЕ ПОЛЬЗОВАТЕЛЕМ сервисное уведомление (opt-in самим фактом сохранения поиска), доставляемое через IN_APP → **transactional-always, не гейтится `notification_prefs.promo`** (который управляет будущими EMAIL/SMS *маркетинговыми* рассылками); opt-out — удаление сохранённого поиска. **WHY:** AUDIT4 отметил отсутствие любого цикла возврата со стороны спроса — пользователь сохраняет поиск и никогда не узнаёт о появлении подходящего листинга — сильнейший сигнал удержания для двустороннего маркетплейса. Событие, таблица, seam OfferingRef (0032) и инфраструктура consumer (0030, ADR-0021) уже существовали; не хватало лишь строки-шаблона + матчера. **WHY-BETTER-для-всего-проекта:** потребление существующего `Listing.Activated` (а не сопоставление внутри tx модерации) держит модерацию в неведении о сохранённых поисках — сбой сопоставления лишь ретраит доставку ЭТОГО consumer'а, но не может откатить валидное одобрение; детерминированный по-парный ключ даёт exactly-once без новой схемы (нет колонки-маркера, нет цикла опроса); правило якоря ADR-0002 структурно обеспечивает разделение рынков в предикате сопоставления; а seed шаблона как EMAIL делает будущий провайдер email/SMS чистым дополнением. EN-оригинал обновлён.

> **(round-N, нормативно — поверхность `ConfirmedSale.*` + спящий захват с якоря передачи, ADR-0038 репутация FORM-слайс #1) WHAT:** добавлены события `ConfirmedSale.{Confirmed,Created,Disputed,Expired}` (aggregate = `ConfirmedSale`) в §2. В этом слайсе **производится** ТОЛЬКО `ConfirmedSale.Confirmed` — модулем animal/transfer внутри транзакции `accept` (PENDING→COMPLETED), записывается в **той же tx**, что и авто-CONFIRMED-строка `confirmed_sales`, рядом с существующим `OwnershipTransfer.Accepted`. `Created`/`Disputed`/`Expired` — **зарезервированы** (пока нет producer'а): `Created` эмитится только с отложенного пути listing-`markSold` номинации покупателя (за `feature_toggles.sale_buyer_confirmation`), `Disputed`/`Expired` — с отложенного слайса поведения репутации / свипера истечения. **Ни один consumer не подписан на `ConfirmedSale.*` сегодня** — применяется путь relay «нет подходящего consumer'а → пометить обработанным» (спящий захват; сигнал копится, никто не слушает). **Решение Created-против-Confirmed (то, что пометил ADR-0038 §3):** якорь передачи эмитит **только `ConfirmedSale.Confirmed`, никогда `ConfirmedSale.Created`.** Обоснование — по машине состояний спеки-18 §4 завершённая передача уже двусторонняя (ADR-0013), поэтому её строка `confirmed_sales` **рождается в статусе CONFIRMED без фазы PENDING_CONFIRMATION** (`[*] --> CONFIRMED`); `ConfirmedSale.Created` определён как «записана строка PENDING_CONFIRMATION (якорь markSold)», так что его эмиссия с пути передачи ложно сигнализировала бы о фазе ожидания подтверждения, которой не существует. Определение `Confirmed` явно включает «auto on TRANSFER anchor», поэтому оно — семантически честное единственное событие для этого пути. **WHY:** AUDIT4 P3-1 — сигнал подтверждённой сделки (особенно сильнейший, завершённая передача) теряется навсегда, если не захвачен в момент, когда происходит; ИИ-оператор/notification/аналитика могут действовать только на транзакции, которую они *видят* как события. **WHY-BETTER-для-всего-проекта:** переиспользует построенный transactional-outbox + forward-only replay + no-purge guardrail (ADR-0021) без нового механизма событий; спящая эмиссия с пути передачи захватывает необратимо-теряемый сигнал до появления поведения (логика reserved-first `view_count`/D1, применённая к событиям); эмиссия в той же tx означает, что событие атомарно со сделкой и никогда молча не теряется (режим отказа мёртвого-слоя-событий F4/AUDIT3 исключён). EN-оригинал обновлён.

> **(round-N, нормативно — follow-ups H4: аналитическое событие `SavedSearch.Matched` + подстрочное совпадение `q` теперь живые, follow-ups Slice H4) WHAT:** два обновления к примечанию H4 выше. **(1)** примечание H4 гласило «событие `SavedSearch.Matched` … не нужно» для *дедупа* — это по-прежнему верно (дедуп — по-парный `idempotency_key` уведомления), но `SavedSearch.Matched` теперь **дополнительно** эмитится как **аналитическое** событие (строка добавлена в §2), НЕ как механизм дедупа. Оно производится `SavedSearchMatchConsumer` **в той же транзакции, что и — и только когда — по-парная строка уведомления реально вставлена** (ветка `ON CONFLICT DO NOTHING`, где INSERT выиграл): повторно доставленный `Listing.Activated` перезапускает идемпотентный INSERT (0 строк) → события нет, поэтому аналитическое событие **exactly-once на пару**, согласовано с SS-M4. **Ни один consumer не подписан** (dormant; питает будущую воронку match→view→contact, которую специфицирует data-analyst). **(2)** формулировка примечания H4 «`q` свободный текст НЕ вычисляется» **отменена** — `q` теперь вычисляется серверно как регистронезависимое **подстрочное** совпадение по title+description обеих локалей листинга (спека 07 **SS-M2**, обновлена на месте); это подстрока (без стемминга/ранжирования), не требует изменения схемы, а поиск с `q` всё равно обязан удовлетворить остальные фильтры. **WHY:** аналитическое событие — шов, на котором держится воронка спроса (одни строки `notification_logs` тяжело собрать в воронку), а текстовый поиск, игнорирующий свой терм, был неожиданным пробелом H4. **WHY-BETTER-для-всего-проекта:** эмиссия события в выигравшей INSERT-tx переиспользует гарантию outbox «атомарно с DB-изменением» ради exactly-once с **нулём нового стора дедупа**, а реализация `q` как in-memory-подстроки держит слайс **zero-DDL**, оставляя апгрейд до стеммингованного FTS за швом-ADR. EN-оригинал обновлён.

## Верификация
- Воркер строится исключительно по §1 + §2 (нет недостающих producer/consumer/payload).
- У каждого шаблона из §3 есть seed-строка (seed-миграция уведомлений).
- Consumers идемпотентны (повторная доставка не даёт двойного эффекта).

## Связанное
- [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md), `database_schema.sql` (`outbox_events`, `notification_templates`)
- [Домен уведомлений](13-notification-domain.md), [Домен модерации](12-moderation-domain.md), [Стейт-машина листинга](statemachines/listing_state_machine.md)
- 🌐 EN: [docs/specs/event-catalog.md](../../docs/specs/event-catalog.md)
