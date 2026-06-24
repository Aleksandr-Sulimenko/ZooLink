---
version: "1.0"
lastUpdated: "2026-06-18"
author: "Architecture Review Board"
status: "Approved"
---

# Спецификация: Управление данными — ПДн, retention, erasure, аудит (ФЗ-152)

## Результат
Делает governance реализуемым. Даёт **реестр ПДн**, **процедуру erasure/анонимизации** (согласованную с append-only
аудитом и FK RESTRICT), **retention/pruning**, контракт **audit-log** и **governance справочников / feature-toggles**.
Закрывает governance-пробелы раунда 4.

## 1. Реестр ПДн (ФЗ-152) — нормативно
| Table.column | Категория | При erasure |
|---|---|---|
| `users.phone_hash` | идентификатор (keyed HMAC) | NULL |
| `users.contact_phone`, `users.contact_telegram` | контактные ПДн | NULL |
| `users.contact_prefs` | настройка видимости контактов | сброс к default колонки |
| `users.email` | контактные ПДн | NULL |
| `users.full_name` | персональные | → `'[deleted]'` |
| `users.avatar_url` | медиа | удалить объект из S3, NULL |
| `users.last_login_at`, `users.oauth_*` | поведенч./идентиф. | NULL |
| `organizations.inn/kpp/email/phone/address` | бизнес-ПДн | NULL при erasure org (минимум по закону — сохранить) |
| `notification_logs.recipient`, `.content` | контактные ПДн | NULL / не хранить тело (только template_id+params) |
| `contact_reveals.*` | аудит раскрытий | id сохраняются; в рамках retention |
| `listings.lat/lng` | геолокация (приблиз.) | сохраняется (грубая); точная точка не хранится |
| `audit_log.actor_id` | идентификатор оператора | сохраняется (non-repudiation) |

Логи обязаны **маскировать** всё перечисленное (никаких сырых phone/email/token/ФИО) — см. `nfr/observability.md`.

## 2. Процедура erasure / анонимизации
Право на забвение (ФЗ-152) согласовано с трассируемостью как **анонимизация на месте с сохранением UUID**:
1. Запрос удаления → `status = DEACTIVATED`, **grace 30 дней** (восстановимо).
2. После grace — `erase_user(user_id)` — запускается автоматически **retention-задачей** только в worker
   (D2; `RETENTION_GRACE_DAYS`, по умолчанию 30) либо вручную ADMIN; для прогона задачи актёр = **system**:
   - анонимизировать ПДн `users` по таблице выше (UUID сохраняется → строки с FK RESTRICT валидны).
   - NULL `notification_logs.recipient/content` пользователя; удалить S3-аватар.
   - **Под legal hold (НЕ стирается):** `audit_log`, `moderation_decisions` (append-only), `animal_ownership_history`,
     `payment_transactions`/`refunds` (закон о фин. учёте).
   - запись `audit_log` `action='user.erased'`.
3. Бэкапы: erasure применяется к live-данным немедленно; ПДн в бэкапах истекают по retention бэкапа; restore обязан
   переиграть журнал erasure (`audit_log action='user.erased'`).

> Это снимает противоречие между `user_state_machine.md` («anonymize») и спекой identity («удаление отложено»):
> **деактивация — MVP; анонимизация-erasure — определённая процедура, исполнимая в MVP через `erase_user`.**

## 3. Журнал аудита
Append-only `audit_log` (`database_schema.sql`, триггер `trg_audit_log_append_only`). Каждое привилегированное/
чувствительное действие пишет строку: смена ролей, бан/suspend, флип toggle, изменение справочников, экспорт данных,
erasure, действия модерации (в дополнение к `moderation_decisions`). Поля: actor_id+role, action, entity,
before/after JSONB, ip, user_agent, created_at. Доступ — admin `GET /audit/log` (только ADMIN).

## 4. Retention / pruning
| Данные | Срок |
|---|---|
| `notification_logs` | 90 дней, затем prune (или раньше маскировать recipient/content) |
| `contact_reveals` | 12 месяцев (окно расследования абьюза), затем prune |
| `outbox_events` (обработанные) | prune `processed_at < now()-7d` (cron в worker) |
| `audit_log` | 3 года (закон/безопасность) |
| Логические бэкапы БД | 30 дн / 12 нед / 12 мес (storage.md) |

## 5. Governance справочников (Admin)
- `species`, `breeds`, `cities` имеют `is_active` (soft-деактивация; деактивированные значения валидны для
  существующих ссылок, но скрыты из новых выборов; без каскадного удаления). Изменения — в audit-log.
- **Сидинг (MVP):** идемпотентная seed-миграция из РФ-источников — species/breeds (FCI/АКК), cities (подмножество FIAS РФ).
  Демо-строки в `database_schema.sql` — плейсхолдеры; продовый сид — отдельная миграция.
- Переименованная/деактивированная порода/город не ломает существующих животных/пользователей (FK сохранён).

## 6. Governance feature-toggles
- Единый источник истины — `feature_toggles`; переключает только ADMIN через `PATCH /system/settings/{key}`,
  что пишет `updated_by` и строку `audit_log`.
- **`rollout_percentage` детерминирован:** пользователь в роллауте если
  `(hashtext(key || user_id::text) & 2147483647) % 100 < rollout_percentage` (стабильно per-user, без мерцания).
- Канонические MVP-toggles: `payments` (off), `digital_assets` (off) + продуктовые по мере добавления. Старый список
  `CHAT_ENABLED/VIDEO_ENABLED/...` из ранних черновиков заменён засеянным набором.

## Связанное
- `database_schema.sql` (audit_log, refresh_tokens, *_is_active, feature_toggles.updated_by), `nfr/security.md`,
  `nfr/observability.md`, `06-admin-domain.md`, `storage.md`, [ADR-0006](../04-decisions/0006-ai-agents-operate-platform.md)
- 🌐 EN: [docs/specs/data-governance.md](../../docs/specs/data-governance.md)
