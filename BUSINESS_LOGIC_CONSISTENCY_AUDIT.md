---
title: "Аудит бизнес-логической консистентности ZooLink + готовность к реализации"
auditor: "Lead System Analyst"
date: "2026-06-17"
scope: "Кросс-документная согласованность бизнес-логики: ADR ↔ стейт-машины ↔ схема ↔ API-контракты ↔ требования"
status: "Final"
---

# Аудит бизнес-логической консистентности и готовности к реализации

> ## ✅ Статус устранения — P0 закрыт (2026-06-17)
> Reconciliation-итерация выполнена и провалидирована (контракты парсятся, диаграммы рендерятся), EN+RU:
> - **D1+D2** — модель статуса листинга унифицирована под канон (`status` 6-значный + отдельный `moderation_status`). Обновлены **ADR-0003** (с заметкой-маппингом, решение пре-модерации не изменено), **ADR-0005** (контакты при `ACTIVE`), 5 бизнес-/UI-доков; pet/livestock data-contract ENUM приведён к канону + маппинг user-facing терминов (COMPLETED→SOLD, ARCHIVED→DEACTIVATED, CONTACTED=событие).
> - **D3** — guard `ACTIVE→SOLD` исправлен: `payment_transactions.status = COMPLETED` (было несуществующее `CONFIRMED`).
> - **D6+M4** — `listings-api.yaml` (EN+RU) догнан до схемы: добавлены `status`/`moderation_status`/`published_at`/`sold_at`/`transaction_id`/`lat`/`lng`; попутно починен предсуществующий YAML-парс-баг (незакавыченные описания с фигурными скобками) — теперь контракт валиден.
>
> Осталось: **P1** (D4 creator_id/seller_id, M1 недостающие OpenAPI, M2 traceability, D5 moderation_log), **P2** (M3 глоссарий, D7 VET/VETERINARIAN).

> Структурная консистентность (EN↔RU, схема↔спека, полнота BPMN/ER) уже закрыта тремя аудитами этой сессии: `EN_RU_CONSISTENCY_AUDIT.md`, `DATABASE_SCHEMA_AUDIT.md`, `PREDEV_READINESS_AUDIT.md`. Настоящий отчёт ищет **логические/смысловые** расхождения между артефактами и фиксирует, что доработать **до начала кода**.

---

## 1. Резюме

Фундамент крепкий: схема исполняется на PG14 (26 таблиц), стейт-машины и BPMN нарисованы, EN↔RU в паритете. **Но** найден пласт **бизнес-логических расхождений терминологии и моделей** между ADR (авторитетные решения), стейт-машинами/схемой (де-факто канон реализации) и API-контрактами (отстали). Самое опасное — **разные модели статуса листинга** в ADR-0003 и в стейт-машине/схеме, и **API-контракт листингов, не отражающий новую модель статусов**. Это прямые источники багов при реализации.

**Вердикт готовности:** 🟡 **почти готово — нужна короткая reconciliation-итерация спецификации (P0) перед кодом.**

---

## 2. Логические расхождения (бизнес-логика)

### D1 — Терминология статуса листинга: `PUBLISHED` vs `ACTIVE` (HIGH)
Канон (стейт-машина `listing_state_machine.md` + `database_schema.sql`): статус `ACTIVE`. Но `PUBLISHED` употребляется как статус в:
- **ADR-0003** (`0003-pre-moderation-workflow.md:76,90,104,150,152`) — основополагающий ADR модерации;
- **ADR-0005** (`0005-no-chat-mvp.md:78,91,100,141,148`) — показ контактов «только для PUBLISHED»;
- `05-ui-ux/user-flows.md`, `business-requirements/pet-marketplace.md`, `livestock-marketplace.md`, `admin-domain.md`, `nfr/security.md`.
> `PUBLISHED` не входит в CHECK схемы (`DRAFT/PENDING_MODERATION/ACTIVE/EXPIRED/SOLD/DEACTIVATED`). Любой код по этим докам обратится к несуществующему статусу.

### D2 — Разные МОДЕЛИ статуса листинга: ADR-0003 (4 состояния) vs канон (6 + отдельный moderation_status) (HIGH)
- **ADR-0003** декларирует модель: `DRAFT → PENDING_MODERATION → PUBLISHED | REJECTED` (REJECTED → обратно в DRAFT). Один статус, совмещающий жизненный цикл и модерацию.
- **Канон** (SM + схема): `listings.status` (DRAFT/PENDING_MODERATION/ACTIVE/EXPIRED/SOLD/DEACTIVATED) **плюс отдельный** `listings.moderation_status` (PENDING/APPROVED/REJECTED/CHANGES_REQUESTED). Модерация вынесена в отдельное поле + `moderation_decisions`.
> Это не просто слово `PUBLISHED→ACTIVE`, а **расхождение модели**: ADR смешивает модерацию и жизненный цикл, канон — разделяет. Нужно решение: обновить ADR-0003 под двухпольную модель (рекомендуется — она богаче и уже реализована) либо упростить схему под ADR.

### D3 — Платёжный статус: `CONFIRMED` vs `COMPLETED` (MED-HIGH)
Гайды переходов ссылаются на статус платежа `CONFIRMED`, которого нет в каноне платежа (`PENDING/COMPLETED/FAILED/REFUNDED/DISPUTED`):
- `listing_state_machine.md:18,52` — «Payment status = CONFIRMED» для `ACTIVE → SOLD`;
- `ownership_transfer_state_machine.md:37,38` — guard `payment_confirmed = TRUE` (булев флаг — ОК как поле `ownership_transfers.payment_confirmed`, но в связке с листингом статус должен быть `COMPLETED`).
> Привести guard листинга к `payment_transactions.status = COMPLETED`.

### D4 — Имя актёра листинга: `creator_id` vs `seller_id` (MED)
- Канон схемы: `listings.seller_id` (+ опц. `organization_id`/`branch_id`).
- Требования и спека организаций используют `creator_id` как «кто подал, для аудита»: `pet-marketplace.md:34,36,162,181,182,192,193,278`, `11-organization-domain.md:375,381`.
> Либо переименовать `seller_id → creator_id` в схеме (смысл «создатель/податель» точнее для орг-листингов), либо явно задокументировать `creator_id == seller_id`. Сейчас — два имени одной сущности.

### D5 — `moderation_log` vs `moderation_decisions` (LOW-MED)
`business-requirements/pet-marketplace.md` и `livestock-marketplace.md` ссылаются на `moderation_log`; канон — append-only `moderation_decisions`. Выровнять имя.

### D6 — API-контракт листингов отстал от модели статусов (HIGH, блокер реализации)
`api-contracts/listings-api.yaml` оперирует булевым `is_active` (и `price_cents`), но **не содержит** `status`/`moderation_status` (6-/4-значные перечисления), `lat`/`lng`, `published_at`/`sold_at`, `transaction_id`. Контракт описывает старую модель.
> Уточнение: enum-поля `listing_type` (`sale/breeding/show/adoption/stud_service`) и `sex` (`Male/Female`) в контрактах **совпадают** со схемой — расхождение именно в **модели статуса**, а не во всех перечислениях.
> API-first реализация по этому контракту разойдётся со схемой. Контракт нужно догнать до канона.

### D7 — Ветеринар: `VET` vs `VETERINARIAN` (LOW)
`role_in_org` (организационная роль) использует токен `VET` (`11-organization-domain.md:24,65,167,174,245`), а `users.role` (платформенная роль) — `VETERINARIAN` (`identity-domain.md:37,39,173`). Это **две разные ролевые системы**, поэтому не баг, но один и тот же профессиональный смысл записан двумя токенами.
> Зафиксировать тождество в глоссарии (org-роль `VET` ≡ платформенная `VETERINARIAN`) либо унифицировать токен, чтобы избежать путаницы при реализации авторизации.

---

## 3. Недостающие артефакты (пробелы перед реализацией)

| # | Пробел | Влияние |
|---|--------|---------|
| M1 | **Нет OpenAPI-контрактов** для доменов Payment (14), Notification (13), Moderation (12), Geo-search (07). Есть только: admin, animals, auth, branch, listings, matching, organization. | Эти домены нельзя реализовать API-first без контракта. |
| M2 | **Traceability matrix не покрывает** новые домены/таблицы (payment/notification/moderation/favorites/saved_searches/content_reports/principal_type). | Теряется трассируемость BR→домен→тест для половины операционной системы. |
| M3 | **Глоссарий** не содержит новых терминов: principal/agent (ADR-0006), moderation_status, listing.status-состояния, content report. | Риск терминологического дрейфа при реализации. |
| M4 | `listings-api.yaml` не содержит новых полей листинга (см. D6). | Дублирует D6 как конкретную задачу. |

---

## 4. Что КОНСИСТЕНТНО (бизнес-логика в порядке)

- **Владение животным** = XOR (owner/org), решение зафиксировано (ADR + схема + требования выровнены).
- **Пре-модерация** (ADR-0003) концептуально согласована с `moderation_decisions` (append-only) и BPMN-схемой модерации — расходится только терминология статуса (D1/D2), не сам поток.
- **Стейт-машины** listing/user/ownership/payment/notification — внутренне согласованы, нарисованы и провалидированы рендером.
- **Конвенция ID** (UUID сущности / INT справочники) — единообразна по схеме, ERD, контрактам (после фикса city_id).
- **Деньги** — BIGINT minor units везде, без FLOAT.
- **ИИ-агенты как принципалы** (ADR-0006) — заложено в `users.principal_type`, согласовано с ролями и аудитом.
- **Enum-поля контрактов** `listing_type` и `sex` — совпадают со схемой (проверено в `listings-api.yaml`/`animals-api.yaml`).

---

## 5. Доработки перед реализацией (приоритизировано)

### P0 — reconciliation спецификации (закрыть до кода)
1. **D1+D2: унифицировать модель статуса листинга.** Принять канон (status + moderation_status), обновить **ADR-0003** и **ADR-0005** (`PUBLISHED→ACTIVE`; описать двухпольную модель; «контакты показываются при `status=ACTIVE`»). Выровнять 5 business-req/ui-доков.
2. **D6+M4: догнать `listings-api.yaml`** до схемы (status, moderation_status, lat/lng, published_at/sold_at, transaction_id).
3. **D3: исправить guard** «Payment = CONFIRMED» → `COMPLETED` в `listing_state_machine` (и сверить формулировку в ownership-transfer).

### P1 — полнота контрактов и трассируемости
4. **M1: написать OpenAPI** для Payment / Notification / Moderation / Geo-search (по образцу существующих).
5. **D4: решить `creator_id` vs `seller_id`** (переименовать или задокументировать тождество) — затронет схему/контракт/требования.
6. **M2: обновить traceability matrix** новыми доменами/BR.
7. **D5: `moderation_log → moderation_decisions`** в 2 marketplace-доках.

### P2 — гигиена
8. **M3: дополнить глоссарий** (principal/agent, статусы листинга/модерации, content report) + **D7: зафиксировать `VET` ≡ `VETERINARIAN`**.
9. Прогон рендера всех диаграмм + EN↔RU зеркалирование всех правок выше.

---

## 6. Дальнейшие шаги: дизайн или бэкенд?

**Рекомендация — последовательность:**

1. **Сначала короткая spec-reconciliation (P0, ~небольшой объём).** Это не «ещё аудит», а устранение противоречий, на которых иначе будет построен баг (модель статуса, API-контракт). Высокий рычаг, малый объём.
2. **Параллельно — «дизайн API» = завершить OpenAPI-контракты (P1.M1).** Для API-first продукта это и есть проектный слой перед бэком; UI-дизайн (05-ui-ux пока тонкий) не на критическом пути MVP (ADR-0005 — без чата, фронт-поверхность мала).
3. **Затем — бэкенд MVP-ядра** в порядке зависимостей: **Identity → Animal → Organization → Listings + Moderation** (схема для них зрелая и провалидирована). Payment — пост-MVP (гейт `feature_toggles.payments`).
4. **UI/UX-вайрфреймы** (`05-ui-ux/wireframes/` пуст) — параллельно, по мере готовности контрактов; не блокер бэка.

**Короткий ответ:** не «дизайн ИЛИ бэк», а: **(1) закрыть P0-противоречия → (2) доконтрактить API → (3) бэкенд ядра MVP**, фронт-дизайн в параллели и не на критическом пути.

---

_Связанные отчёты: `DATABASE_SCHEMA_AUDIT.md`, `PREDEV_READINESS_AUDIT.md`, `EN_RU_CONSISTENCY_AUDIT.md`. Источник истины: `database_schema.sql` + стейт-машины; ADR — авторитетные решения, но при дрейфе с реализованным каноном требуют обновления (новый ADR/superseded или правка по согласованию)._
