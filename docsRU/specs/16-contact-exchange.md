---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Спецификация: Обмен контактами (MVP — без чата)

## Результат
Определяет, как покупатель связывается с продавцом в MVP, поскольку встроенный чат вне scope
([ADR-0005](../04-decisions/0005-no-chat-mvp.md)). Закрывает разорванный шов, где journey обрывался на «связаться
с продавцом» без механизма. Таблицы чата (`conversations`, `messages`) остаются в схеме **зарезервированными под
Фазу 2+** и не используются бэкендом MVP.

## Механизм
На **ACTIVE** объявлении **аутентифицированный** пользователь запрашивает контакт продавца через
`POST /api/v1/listings/{id}/contact-reveal`. API возвращает доступные каналы связи продавца
(по `users.contact_prefs`) и **логирует раскрытие** в `contact_reveals`.

- **Гейтинг:** вызывающий аутентифицирован; listing.status = `ACTIVE`; вызывающий ≠ продавец.
- **Что раскрывается:** только включённые продавцом каналы — `contact_phone` (если `show_phone`) и/или
  `contact_telegram` (если `show_telegram`). Больше ничего (ни email, ни ФИО сверх отображаемого).
- **Персистентность:** одна строка `contact_reveals(listing_id, viewer_id, seller_id)` на раскрытие (аудит +
  статистика владельца + детект абьюза). Телефон/telegram хранятся на `users` как отображаемые поля (отдельно от
  `phone_hash` для аутентификации).

## Ограничение скорости (анти-скрейпинг, минимизация ПДн по ФЗ-152)
Жёсткий лимит в Redis по ключу `viewer_id`:
- **Pet:** 10 раскрытий / час / пользователь.
- **Livestock:** 5 раскрытий / час / пользователь.
Превышение → `429` с `Retry-After` (по `nfr/security.md` и `API_CONVENTIONS.md` §8). `contact_reveals` — durable
аудит; почасовой счётчик — в Redis.

## Приватность (ФЗ-152)
Контакт раскрывается **только после модерации** (ACTIVE ⇒ APPROVED) и **только по явному запросу**, никогда не в
списках/поиске. Продавец управляет раскрытием через `contact_prefs`. Раскрытия логируются для подотчётности.

## Данные
- `users.contact_phone`, `users.contact_telegram`, `users.contact_prefs` (JSONB `{show_phone, show_telegram}`) — миграция 0005.
- `contact_reveals(id, listing_id, viewer_id, seller_id, created_at)` — миграция 0005.

## Событие
Раскрытие эмитит `ContactReveal.Created` (см. [event-catalog.md](event-catalog.md)) для статистики владельца.

## Верификация
- Неаутентифицированный / не-ACTIVE листинг / своё объявление → отклонено.
- 11-е раскрытие pet за час → `429`.
- Возвращаются только включённые продавцом каналы.

## Связанное
- [ADR-0005](../04-decisions/0005-no-chat-mvp.md), [event-catalog.md](event-catalog.md), `nfr/security.md`, `security/rbac-matrix.md`
- 🌐 EN: [docs/specs/16-contact-exchange.md](../../docs/specs/16-contact-exchange.md)
