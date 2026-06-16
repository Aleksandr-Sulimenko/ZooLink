---
title: "Предпроектный аудит готовности: визуальные модели (BPMN / ER) ZooLink"
auditor: "Lead System Analyst"
date: "2026-06-17"
scope: "Полнота визуальных моделей данных (ER/SQL) и процессов (BPMN) в docs/ (EN-канон)"
status: "Final"
---

# Предпроектный аудит готовности ZooLink — визуальные модели

> ## ✅ Статус устранения — P0 закрыт (2026-06-17)
> Все 4 пункта P0 реализованы как mermaid-модели (рендер провалидирован mermaid-cli, EN+RU):
> - **Стейт-машина платежа** → `specs/statemachines/payment_state_machine.md` (диаграмма + таблицы переходов).
> - **Стейт-машина уведомления** → `specs/statemachines/notification_state_machine.md`.
> - **BPMN-поток платежа** (актёры User/Backend/Gateway + ветки success/fail/timeout/dispute/refund) → раздел в `specs/14-payment-domain.md`.
> - **BPMN-поток передачи владения** (2-стороннее подтверждение + вет/юр/платёж ветки) → `specs/statemachines/ownership_transfer_state_machine.md` (+ state-диаграмма).
> - **BPMN-поток модерации** (approve/reject/changes_requested/SLA-timeout, актёры Owner/Moderator/System) → раздел в `specs/12-moderation-domain.md`.
> Осталось: **P1** (модели favorites/saved-search/user-reports + решения скоупа), **P2** (нарисовать 3 существующие стейт-машины listing/user, синхронизировать ASCII-ERD, текстовые противоречия).

> Цель: оценить, достаточно ли **визуальных моделей** (ER/SQL для данных, BPMN/процессные схемы для логики), чтобы команда начала реализацию по диаграммам. Источник истины по данным — `database_schema.sql` + `ZooLink_ERD.mmd`; процессы — спеки `docs/specs/01..15`, бизнес-требования `docs/02-requirements/business-requirements/*`, стейт-машины `docs/specs/statemachines/*`.

---

## Инвентаризация визуальных моделей (что вообще есть)

| Тип модели | Наличие | Где |
|---|---|---|
| **ER-диаграмма (mermaid)** | ✅ Есть, полная | `ZooLink_ERD.mmd` — 23 сущности = 23 таблицы схемы, с типами и FK |
| **SQL DDL** | ✅ Есть, **исполняется** | `database_schema.sql` (проверен на живом PostgreSQL 14) |
| **ER в data-model.md** | ⚠️ ASCII-арт, устаревший | Текстовая «псевдо-ERD» только по MVP-ядру, без Payment/Moderation/Notification |
| **State machines** | ⚠️ Только таблицы | 3 шт. (listing/user/ownership_transfer) — states + transitions в markdown-**таблицах**, диаграмм нет (0 mermaid) |
| **Sequence-диаграммы** | ⚠️ Частично | 7 доменов (identity, animal, organization, pet/livestock, matching, admin); error-ветки у большинства отсутствуют |
| **Flowchart / BPMN процессов** | ❌ **Нет** | Слово «BPMN» не встречается ни разу; flowchart есть только в C4-архитектуре (component/container/deployment/system-context), не для бизнес-процессов |
| **C4-диаграммы** | ✅ Есть | system-context, container, component, deployment |
| **Gherkin-сценарии** | ✅ Точечно | `business_logic/geo_search_eligibility.feature` |

**Главный вывод инвентаря:** сторона **данных смоделирована визуально и полно**; сторона **процессов держится на тексте** (таблицы переходов + частичные sequence-диаграммы), **полноценных процессных схем (BPMN/swimlane) нет**.

---

## ШАГ 1: Извлечённые сущности и процессы

### Сущности (существительные)
Identity: **User** (+ OAuth-идентификаторы, роли, статус). Animal: **Animal**, **AnimalOwnershipHistory**, **OwnershipTransfer**. Organization: **Organization**, **Branch**, **OrganizationUser** (M:N). Marketplace: **Listing**, **ListingPhoto**, **Conversation**, **Message**. Moderation: **ModerationDecision**, **ModerationReason**. Payment: **PaymentTransaction**, **Refund**. Notification: **NotificationTemplate**, **NotificationLog**. Справочники: **Species**, **Breed**, **City**, **SupportedLanguage**. Система: **FeatureToggle**, **OutboxEvent**.
Упомянуты в тексте, но **без сущности/таблицы**: **Favorite** (избранное), **SavedSearch/SavedLocation**, **UserReport/ContentFlag** (жалобы), **Review/Rating** (отложено в Phase 2), **Match** (вычисляется, не хранится), **VerificationCode/OTP** (транзиентно).

### Процессы (глаголы/сценарии)
1. Регистрация и верификация пользователя (SMS/OAuth).
2. Создание объявления → пре-модерация → публикация (ADR-0003).
3. Рабочий процесс модерации (очередь → решение → уведомление).
4. Передача владения животным (инициация → подтверждение сторон → платёж → завершение).
5. Платёжный поток (инициация → шлюз → подтверждение/отказ → возврат).
6. Подбор (matching) пар для разведения.
7. Гео-поиск с проверкой допустимости.
8. Отправка уведомлений (шаблон → канал → доставка/ошибка).

---

## ШАГ 2: Аудит SQL/ER модели (полнота данных)

| Сущность (из текста) | В ERD? | Все атрибуты? | Типы данных? | Связи (FK)? | Проблема / Что missing |
|---|---|---|---|---|---|
| User | ✅ | ✅ | ✅ | ✅ | OK. (Зарезервированные `average_rating`/`review_count` из mvp-scope.md:94 в схеме отсутствуют — Phase 2.) |
| Animal | ✅ | ✅ | ✅ | ✅ | OK (после ремедиации: + breeding-атрибуты) |
| AnimalOwnershipHistory | ✅ | ✅ | ✅ | ✅ | OK |
| OwnershipTransfer | ✅ | ✅ | ✅ | ✅ | OK (добавлена; в MVP смена владельца заблокирована триггером) |
| Organization / Branch / OrganizationUser | ✅ | ✅ | ✅ | ✅ | OK (M:N с UNIQUE(org,user)) |
| Listing / ListingPhoto | ✅ | ✅ | ✅ | ✅ | OK (+ status/moderation_status/lat-lng/transaction_id) |
| Conversation / Message | ✅ | ✅ | ✅ | ✅ | OK (чат отложен ADR-0005, но таблицы есть) |
| ModerationDecision / ModerationReason | ✅ | ✅ | ✅ | ✅ | OK (append-only audit + триггер immutability) |
| PaymentTransaction / Refund | ✅ | ✅ | ✅ | ✅ | OK (деньги BIGINT minor units); гейт `feature_toggles.payments=false` |
| NotificationTemplate / NotificationLog | ✅ | ✅ | ✅ | ✅ | OK |
| Species / Breed / City / SupportedLanguage | ✅ | ✅ | ✅ | ✅ | OK (INT-справочники) |
| FeatureToggle / OutboxEvent | ✅ | ✅ | ✅ | ✅ | OK |
| **Favorite (избранное)** | ❌ | ❌ | ❌ | ❌ | **MVP-фича** (spec 03:19 и задача 03:73 «Implement favorites and sharing»), но **нет таблицы и сущности в ERD**. Нужна `favorites(user_id, listing_id|animal_id, created_at)`. |
| **SavedSearch / SavedLocation** | ❌ | ❌ | ❌ | ❌ | UC-GS-03 (07-geo-search:77–81) описывает сохранение локаций/фильтров. В future-features:15 «Saved searches with alerts» — Phase 2. **Противоречие скоупа** → решить MVP/Phase2; если MVP — добавить таблицу. |
| **UserReport / ContentFlag (жалобы)** | ❌ | ❌ | ❌ | ❌ | 06-admin:87 «process for reporting inappropriate content or users», admin-domain:303 `flag listing`. Куда сохраняется жалоба пользователя — **не определено** (moderation_decisions = действия модератора, не жалобы юзеров). Нужна `content_reports` или явное решение. |
| Review / Rating | ❌ (намеренно) | — | — | — | Явно **отложено** (03/04 «deferred», mvp-scope Phase 2). Таблицы корректно нет; убрать упоминание «зарезервированных полей» из mvp-scope или согласовать. |
| Match (подбор) | ❌ | — | — | — | Похоже **вычисляется на лету** (нет упоминаний хранения). Уточнить: нужна ли история/сохранённые подборы? Если да — `matches`/`match_results`. |
| VerificationCode / OTP | ❌ | — | — | — | Транзиентно (Redis/in-memory). Не таблица — **ОК**, но это нигде не зафиксировано явно; добавить в data-model примечание. |

**Вывод по данным:** покрытие документированных сущностей в ERD — **полное по доменам MVP-ядра и операционным доменам**; ERD содержит атрибуты, типы и FK. Пробелы — **favorites (точно MVP), saved searches и user-reports (требуют решения скоупа)**. ASCII-ERD в `data-model.md` устарел относительно `ZooLink_ERD.mmd` (не показывает новые домены) — синхронизировать или удалить.

---

## ШАГ 3: Аудит BPMN модели (полнота процессов)

| Бизнес-процесс (из текста) | Есть BPMN/схема? | Альт-ветки (Errors/Exceptions)? | Роли (Actor)? | Проблема / Что missing |
|---|---|---|---|---|
| Регистрация и верификация | ⚠️ Sequence (identity-domain) | ✅ частично (5 alt-блоков) | ✅ (User/Frontend/Backend/SMS/OAuth) | Лучше всех проработан. BPMN нет, но sequence с ошибками годится. |
| Создание → модерация → публикация листинга | ⚠️ State machine (текст) + sequence (pet/livestock, по 1 alt) | ⚠️ мало | ⚠️ частично | Жизненный цикл в таблицах listing_state_machine; **процессной схемы (swimlane создатель↔модератор↔система) нет**. |
| Рабочий процесс модерации | ⚠️ Sequence (admin-domain) | ❌ **0 alt-блоков** | ✅ (Moderator/System) | Нет веток reject/changes_requested/SLA-timeout на схеме. Реализатор не увидит ветвления. |
| Передача владения животным | ⚠️ State machine (текст) | ⚠️ FAILED-состояние в таблице | ❌ нет диаграммы | **Нет sequence/BPMN.** Многошаговый 2-сторонний процесс с платежом и таймерами — критично нуждается в схеме. |
| Платёжный поток | ❌ **Нет схемы** | ❌ | ❌ | spec 14 — только текст. PENDING→COMPLETED/FAILED/REFUNDED/DISPUTED, идемпотентность, интеграция со шлюзом — **без единой диаграммы**. Высокий риск. |
| Подбор (matching) | ⚠️ Sequence (matching-domain, 2 alt) | ⚠️ частично | ✅ | Есть последовательность; нет схемы алгоритма скоринга/фильтров. |
| Гео-поиск | ⚠️ Gherkin (.feature) | ✅ сценарии допустимости | ⚠️ | Логика допустимости в Gherkin — хорошо для тестов, но процессной схемы нет. |
| Отправка уведомлений | ❌ **Нет схемы** | ❌ | ❌ | spec 13 — только текст. SENT→DELIVERED/FAILED/BOUNCED, ретраи — без диаграммы. |

**Вывод по процессам:** **BPMN отсутствует полностью.** Часть процессов покрыта sequence-диаграммами (но у половины нет ветвлений ошибок), стейт-машины описаны таблично, но **не визуализированы**. Критичные многошаговые процессы — **платёж, передача владения, уведомления** — не имеют ни одной схемы.

---

## ШАГ 4: Слепые зоны спецификации

**1. Противоречия в тексте?**
- **Скоуп saved searches:** UC-GS-03 (MVP-спека гео) описывает сохранение локаций/фильтров, а future-features:15 относит «saved searches with alerts» к Phase 2. Не согласовано.
- **Reviews/ratings:** помечены «deferred»/Phase 2 (03/04), но mvp-scope:94 утверждает, что в сущности User «зарезервированы поля average_rating/review_count» — в реальной схеме их нет. Документ vs схема.
- **Владение животным:** ранее было «at least one» в требованиях vs XOR в схеме — **уже исправлено** (решение владельца: XOR; см. `DATABASE_SCHEMA_AUDIT.md`).
- **data-model.md ASCII-ERD** не отражает Payment/Moderation/Notification/ownership_transfers — устарел относительно `ZooLink_ERD.mmd`.

**2. Описаны ли статусы сущностей (State Machines)? Нарисованы ли?**
- Описаны: **да** — `listing` (6 состояний), `user` (6), `ownership_transfer` (4); со states, transitions, entry/exit actions и guard-условиями. Качественные таблицы.
- Нарисованы: **нет** — ни одной диаграммы (0 mermaid `stateDiagram`). Для реализации читаемо, но визуально не верифицируемо; легко пропустить недостижимое/тупиковое состояние.
- Без стейт-машины: `payment_transactions.status` и `notification_logs.status` имеют наборы значений в спеке/CHECK, но **формальной стейт-машины переходов нет** (какие переходы легальны для платежа/уведомления — не определено).

**3. Достаточно ли деталей, чтобы написать SQL DDL прямо сейчас?**
- **ДА — для данных.** DDL не просто можно написать — он **уже написан и исполняется** (`database_schema.sql`, проверен на PG14; ERD синхронен). Типы, FK, CHECK, индексы, триггеры на месте.
- **С оговоркой:** для **favorites** и (если MVP) **saved searches / user-reports** таблиц нет — их DDL по текущим диаграммам написать нельзя (нет моделей).

---

## ВЕРДИКТ

# ⚠️ ТРЕБУЕТ ДОРАБОТКИ СПЕКИ

**Сторона ДАННЫХ — фактически готова к разработке** (ERD полон, DDL исполняется и провалидирован). **Сторона ПРОЦЕССОВ — не готова:** нет ни одной BPMN/процессной схемы, стейт-машины не нарисованы, у критичных процессов нет диаграмм вовсе.

### Что обязательно дописать аналитикам ДО старта кода:

**P0 — блокеры реализации процессов:**
1. **BPMN/swimlane для платёжного потока** (spec 14): PENDING→COMPLETED/FAILED/REFUNDED/DISPUTED, идемпотентность, ветки ошибок шлюза, возвраты. Сейчас 0 схем.
2. **BPMN/sequence для передачи владения** (ownership_transfer): 2-сторонний процесс с подтверждениями, платежом, таймерами и веткой FAILED.
3. **Стейт-машины платежа и уведомления** — формализовать легальные переходы `payment_transactions.status` и `notification_logs.status` (сейчас только перечень значений).
4. **Схема рабочего процесса модерации** с ветвлениями (approve / reject / changes_requested / SLA-timeout) — добавить actor-ветки в существующую sequence-диаграмму admin-domain.

**P1 — пробелы данных (решение скоупа + модель):**
5. **Favorite** — MVP-фича без таблицы: добавить сущность в ERD + DDL.
6. **SavedSearch/SavedLocation** — решить MVP vs Phase 2 (UC-GS-03 vs future-features); если MVP — смоделировать.
7. **UserReport/ContentFlag** — определить, где хранятся жалобы пользователей на контент (или явно отнести в Phase 2).

**P2 — визуализация и гигиена (снижают риск, не блокеры):**
8. **Нарисовать 3 существующие стейт-машины** как mermaid `stateDiagram-v2` (логика уже есть в таблицах — это перевод в диаграмму).
9. **Добавить error/alt-ветки** в sequence-диаграммы animal/organization/admin (сейчас 0 ветвлений).
10. **Синхронизировать ASCII-ERD в data-model.md** с `ZooLink_ERD.mmd` (или удалить ASCII, оставив ссылку на канон).
11. Устранить текстовые противоречия: reviews «зарезервированные поля», скоуп saved searches.

### Итого по готовности
| Аспект | Готовность |
|---|---|
| Модель данных (ER/SQL) | 🟢 ~90% — готово (минус favorites/saved-search/reports) |
| Стейт-машины (логика) | 🟢 описаны таблично; 🟡 не визуализированы; платёж/уведомление без SM |
| Процессы (BPMN) | 🔴 ~25% — нет BPMN; критичные потоки без схем |
| **Общая готовность к коду** | **🟡 Данные — да; процессы — нет. Доработать P0/P1 перед стартом.** |

---

_Аудит основан на `docs/` (EN-канон). Связанные отчёты: `DATABASE_SCHEMA_AUDIT.md` (схема БД, ремедиация применена и проверена на PG14), `EN_RU_CONSISTENCY_AUDIT.md` (консистентность EN↔RU)._
