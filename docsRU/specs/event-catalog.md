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
| `OwnershipTransfer.Initiated` | OwnershipTransfer | animal/transfer (T1) | transferId, animalId, fromUserId, fromOrganizationId, toUserId, toOrganizationId | **notification (получателю)** |
| `OwnershipTransfer.Accepted` | OwnershipTransfer | animal/transfer (T2) | (как выше) | **notification (инициатору)** |
| `OwnershipTransfer.Declined` | OwnershipTransfer | animal/transfer (T3) | (как выше) | **notification (инициатору)** |
| `OwnershipTransfer.Cancelled` | OwnershipTransfer | animal/transfer (T4) | (как выше) | **notification (получателю)** |
| `OwnershipTransfer.Expired` | OwnershipTransfer | animal/transfer (T5, ленивое истечение) | (как выше) | **notification (ОБЕИМ сторонам)** |
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

## Верификация
- Воркер строится исключительно по §1 + §2 (нет недостающих producer/consumer/payload).
- У каждого шаблона из §3 есть seed-строка (seed-миграция уведомлений).
- Consumers идемпотентны (повторная доставка не даёт двойного эффекта).

## Связанное
- [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md), `database_schema.sql` (`outbox_events`, `notification_templates`)
- [Домен уведомлений](13-notification-domain.md), [Домен модерации](12-moderation-domain.md), [Стейт-машина листинга](statemachines/listing_state_machine.md)
- 🌐 EN: [docs/specs/event-catalog.md](../../docs/specs/event-catalog.md)
