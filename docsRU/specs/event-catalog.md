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
- **Payload:** JSONB; в каждом — `event_id`, `occurred_at`, `aggregate_id`, `schema_version`.

## 2. Каталог событий MVP

| event_type | aggregate_type | Producer | Payload (ключевое) | Consumers (действие) |
|---|---|---|---|---|
| `Listing.Submitted` | Listing | listing (DRAFT→PENDING_MODERATION) | listing_id, seller_id | moderation (в очередь) |
| `Moderation.Decided` | Listing/Animal | moderation | entity_type, entity_id, decision, reason | listing (применить статус), **notification (уведомить владельца)** |
| `Listing.Activated` | Listing | listing (→ACTIVE) | listing_id, seller_id | search-index (опубликовать), notification |
| `Listing.Expired` | Listing | worker (истёк срок) | listing_id, seller_id | search-index (убрать), **notification** |
| `Listing.Sold` | Listing | listing (владелец отметил продано, MVP) | listing_id, seller_id | search-index (убрать), notification |
| `Listing.Deactivated` | Listing | listing/moderation | listing_id, reason | search-index (убрать), notification (если удалил модератор) |
| `User.Registered` | User | identity | user_id | notification (welcome/verify — SMS инлайн) |
| `ContentReport.Filed` | ContentReport | moderation | report_id, entity_type, entity_id | moderation (в очередь) |
| `ContentReport.Actioned` | ContentReport | moderation | report_id, target, action | listing (деактивировать цель), **notification (репортёру+владельцу)** |
| `ContactReveal.Created` | Listing | contact | listing_id, viewer_id | analytics/counter (rate-limit + статистика владельца) |
| `Payment.Completed` / `Payment.Failed` | Payment | payment | **Фаза 2+ (гейт `feature_toggles.payments`)** | listing (SOLD), notification |

> Producer/consumer — это **модули внутри монолита** (ADR-0009), не микросервисы. «Consumer» = in-process хендлер,
> подписанный на ретранслированное событие.

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

## Верификация
- Воркер строится исключительно по §1 + §2 (нет недостающих producer/consumer/payload).
- У каждого шаблона из §3 есть seed-строка (seed-миграция уведомлений).
- Consumers идемпотентны (повторная доставка не даёт двойного эффекта).

## Связанное
- [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md), `database_schema.sql` (`outbox_events`, `notification_templates`)
- [Домен уведомлений](13-notification-domain.md), [Домен модерации](12-moderation-domain.md), [Стейт-машина листинга](statemachines/listing_state_machine.md)
- 🌐 EN: [docs/specs/event-catalog.md](../../docs/specs/event-catalog.md)
