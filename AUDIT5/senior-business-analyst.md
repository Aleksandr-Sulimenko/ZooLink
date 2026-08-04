# ZooLink AUDIT5 — senior-business-analyst · лейн «BR-покрытие после июльской волны»

**Дата:** 2026-08-04 · **Ветка:** `backend`, HEAD `c44874c` (41 таблица, миграции 0001–0040) ·
**Метод:** для каждой находки прошлых раундов (AUDIT3, AUDIT4) — независимая переверка ПРОТИВ
текущего кода/схемы/доков (grep + чтение), не по памяти отчётов. Базовая линия стенда взята из
`AUDIT5/_AXIS_ASSIGNMENT.md` (712u/405e+9todo GREEN, grep-гейт 0) — сам стенд не гонял (закон лейна).
Апекс-закон: бизнес-требования наверху, ни одно требование не теряется молча (реализовано ИЛИ
явно затрекано с причиной).

---

## 0. Чего этот лейн НЕ увидит (объявлено до находок)

- **Тесты не гонял** — опираюсь на зафиксированный baseline `_AXIS_ASSIGNMENT.md` и на
  свидетельские комментарии в самом коде/миграциях («GAP-012», «AUDIT4 B-1» и т.п.), не на
  собственный прогон.
- **Фронтенд/UX** — вне лейна (SPA-фаза не открыта); смотрю только контракты и БЛ бэкенда.
- **Живые пользователи / психология / анти-паттерны** — лейны active-user и psychologist,
  здесь не переоцениваю.
- **Целостность архитектурных швов «как вписывается в целое»** — держит архитектор-держатель
  отдельным разбором; я фиксирую только видимость требования в доках/контракте.
- **Юридическая квалификация** (ФЗ-152/ФЗ-38/вет-периметр) — лейн legal; упоминаю только там,
  где BR прямо ссылается на закон.
- **P1-1..P2-7 из AUDIT4** (claim-code-в-tx, outbox attempts, advisory-lock, идемпотентность) —
  это не BR-покрытие, а инженерная надёжность; я лишь свёл, какие из них relevant к
  bиз-требованиям (N-1, agent-auth) и не перепроверял построчно остальные — это лейн
  backend-engineer/reviewer-qa/devops.
- **Не проверял EN↔RU зеркало** построчно (это doc-keeper) — только один раз сверил, что
  найденная BR-правка есть в EN-варианте (канон); RU-зеркало не читал.

---

## 1. REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md (v1.1, lastUpdated 2026-06-30) — построчная сверка

**Число: из 14 находок (GAP-TRACE-001..014) — 12 фактически закрыты, 1 частично жива, 1 корректно
отложена. Из 12 закрытых только 3 отмечены `✅ Resolved` В САМОМ документе — остальные 9 документ
всё ещё числит открытыми ⚠️/❌, хотя BR-доки/код давно чинены. Это протухший ledger:
он ссылается на состояние, которого больше нет.**

| ID | Статус в документе (2026-06-30) | Факт сегодня (c44874c) | Вердикт |
|---|---|---|---|
| GAP-TRACE-001 | 🔴 High ⚠️ (открыт) | `species/breeds/cities` получили `sort_order/created_by/updated_by` (мигр. 0018); единый **реестр датасетов** (DATASETS+CAPS) — тот же CRUD/аудит/локализация код для всех lookup-таблиц, описан в `docs/specs/06-admin-domain.md:69-89`. Архитектурное решение принято и задокументировано в spec, **но** `docs/02-requirements/business-requirements/admin-domain.md` (строки 16-24, 175-197) **не правлен** — всё ещё описывает единую generic UUID-таблицу `reference_data(dataset, code, …)`. | **ПРОТУХ (ledger) + ЖИВ (BR-док)** — spec 06 верна, admin-domain.md — нет |
| GAP-TRACE-002 | 🔴 High ❌ (открыт) | `health_certifications`+`genetic_markers` построены (мигр. 0019, тот же комментарий явно пишет `FORM now (GAP-TRACE-002)`). `traits/temperament` и `animal-statuses` **явно** решены иначе (не датасет): комментарий в `database_schema.sql:1509` — "pet-side soft-tags… intentionally free text/JSONB… animal-statuses are a state CHECK enum, not a dataset". Решение задокументировано в схеме, **но** `admin-domain.md` (core concepts, строка 20-23) всё ещё перечисляет "Traits & Descriptors" и "Animal Statuses" как reference-датасеты без пометки об ином решении. | **ПРОТУХ (ledger) + ЖИВ (BR-док, минор)** |
| GAP-TRACE-003 | ✅ Resolved (в самом документе) | Верно — `matching-api.yaml` несёт `x-phase: 2` для scoring/feedback/history. | **Точен, не протух** |
| GAP-TRACE-004 (роли) | 🟠 Med ⚠️ (открыт) | `identity-domain.md:174-185`, `admin-domain.md:97-113`, `glossary.md:142` — 7-ролевой канон реконсилирован ВЕЗДЕ, с явной триплетой WHAT/WHY/WHY-BETTER и ссылкой `GAP-TRACE-004`. | **ПРОТУХ (ledger)** — BR-доки давно исправлены |
| GAP-TRACE-005 | ✅ Resolved | Верно — `leasing` в enum, форма есть/поведение Фаза 2. | **Точен** |
| GAP-TRACE-006 (FLAG) | 🟠 Med ⚠️ (открыт) | `admin-domain.md:48-113` — FLAG заменён на CHANGES_REQUESTED явной нормативной вставкой. | **ПРОТУХ (ledger)** |
| GAP-TRACE-007 | ✅ Resolved | Верно — ADR-0013. | **Точен** |
| GAP-TRACE-008 (role_in_org) | 🟠 Med ⚠️ (открыт) | `organization-domain.md:44-52` — MODERATOR убран, явная триплета, ссылка GAP-TRACE-008. | **ПРОТУХ (ledger)** |
| GAP-TRACE-009 (passwordless) | 🟠 Med ⚠️ (открыт) | `identity-domain.md:18-193` — полностью реконсилирован (passwordless, HMAC, JWT 15m/7d), нормативная врезка с явной ссылкой GAP-TRACE-009. | **ПРОТУХ (ledger)** |
| GAP-TRACE-010 (JWT/HMAC) | 🟠 Med ⚠️ (открыт) | Та же врезка что 009 закрывает и это. | **ПРОТУХ (ledger)** |
| GAP-TRACE-011 (аналитика) | 🟡 Low ❌ (открыт) | `GET /listings/{id}/analytics` (`listings-api.yaml:597-623`) и `GET /organizations/{id}/analytics` (`organization-api.yaml:229-247`) существуют; `view_count` — реальный счётчик (мигр. 0031, дедуп по Redis 30 мин). | **ПРОТУХ (ledger)** |
| GAP-TRACE-012 (авто-экспирация) | 🟡 Low ❌ (открыт) | `backend/src/lib/scheduler/retention.service.ts:23-58` — `@Cron`-джоб, коммент прямо пишет `(GAP-012)`, идемпотентен (`WHERE status='ACTIVE'`). | **ПРОТУХ (ledger)** |
| GAP-TRACE-013 (MFA/сессии/PII) | 🟡 Low ❌ (открыт) | **Частично закрыт**: PII-at-rest — реально построен (мигр. 0028, ADR-0019, AES-256-GCM+HMAC blind-index для email; contact_phone — seam-ready, без read/write-пути). Ложная фраза "MFA-инфраструктура подготовлена" **явно исправлена** (`docs/02-requirements/nfr/security.md:27-38`, коммент "GAP-013… doc↔schema lie"). **НЕ закрыто**: лимит 5 сессий, история входов, terminate-конкретной-сессии, security-алерты на новое устройство — `refresh_tokens` получил колонки `ip_address/user_agent/last_used_at/revoked_reason` (мигр. 0020, "session-form"), но **нет** `GET /me/sessions` / `DELETE /me/sessions/{id}` эндпоинта — только форма, поведение не начато. `identity-domain.md:151-157` (UC-ID-05) продолжает обещать это как приёмочный критерий **без пометки о частичной реализации**. | **ЖИВ (частично)** — см. §5 сэмпл №3 |
| GAP-TRACE-014 (a11y) | 🟡 Low ❌ (открыт) | Фронтенд-фаза не открыта; `nfr/accessibility.md` сам себя корректно маркирует Фаза 2, `docs/specs/05:71` — единственная сквозная ссылка. Ничего не изменилось с 2026-06-30 — и это **честно**, доку не нужно ничего чинить. | **ЖИВ, корректно отложен** — не дефект |

**Итог по числу:** 3/14 отметок в самом ledger-документе точны (003/005/007). 9/14 (001,002,004,
006,008,009,010,011,012) **протухли** — BR-доки/код давно чинены, но
`REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md` (шапка `lastUpdated: "2026-06-30"`, 35 дней без правки)
никогда не подтянут "✅ Resolved" за ними. 2/14 (013 частично, 014 полностью) — живы честно.
**Ни один пункт не ссылается на файл/строку, которого физически не существует** — расхождение
исключительно смысловое (устаревший вердикт), не битая ссылка.

---

## 2. GAP-BA-001 — `price_or_terms` для livestock/pet (был CRITICAL в AUDIT3, "confirmed-open" в AUDIT4)

**Статус сегодня: ПО-ПРЕЖНЕМУ ОТКРЫТ, без единой пометки-деферрала. Единственный найденный в этом
раунде BR-разрыв без трек-записи.**

- `database_schema.sql:270` — `price_cents BIGINT` (nullable), больше НИЧЕГО: нет
  `price_terms_text`/`price_or_terms`. Подтверждено также `chk_listings_price_nonneg` (строка 1169)
  — колонка чисто числовая, неотрицательная.
- `backend/src/modules/listing/dto/listing.dto.ts:99,163,363` — `priceCents?: number` /
  `priceCents: number | null` — единственное поле цены в DTO, ни `create`, ни `update`, ни `read`
  не несут текстовой альтернативы.
- BR-доки не изменились со времён AUDIT3: `docs/02-requirements/business-requirements/livestock-marketplace.md:26-29,178,194-199`
  всё ещё содержит образцы `"50000 per straw"`, `"negotiable"`, `"package: 3 straws + synchronization"`
  как значения `price_or_terms VARCHAR(150)`; `pet-marketplace.md:25-27,170-192` — то же для
  `"pick of litter"`/`"free"`/`"negotiable"`. Ни там, ни в `database_schema.sql`, ни в
  `admin-domain.md` **нет ни одного упоминания `GAP-BA-001`** (для сравнения: соседний
  `GAP-BA-005` про `show`-тип listing аннотирован явно в тех же файлах).
- Затронутые типы листингов: `stud_service`/MATING (оба рынка) и `leasing` (только livestock) —
  ровно та часть каталога, где цена — не число, а условие сделки.
- **Почему это не "живой" пункт, а именно антараей-дефект:** находка была зафиксирована CRITICAL
  в AUDIT3 (2026-07-02) и переподтверждена в AUDIT4 (2026-07 середина, "P4 record-only,
  CONFIRMED-open") — за прошедший месяц прошли 6+ миграций (agent-auth, reputation×2,
  saved-search-follow-ups, доккиперская зачистка) в СОСЕДНИХ доменах, но ни одна не тронула этот
  давно названный CRITICAL. `metadata: antaraya: стьяна (объявление есть, действия нет — CRITICAL
  зафиксирован дважды в двух раундах, ни одного коммита за месяц)`.
- **Fix (не выполняю, только фиксирую):** добавить `price_terms_text VARCHAR(150)` рядом с
  `price_cents` (аддитивно, без переписывания) + DTO-валидация "число ИЛИ текст" — либо формально
  урезать BR до price_cents-only с тройкой WHAT/WHY/WHY-BETTER (тогда придётся переписать все
  примеры из livestock/pet-marketplace.md — дороже, т.к. меняет продающую способность для
  stud_service/leasing).

---

## 3. AUDIT4_HARDENING.md forward-plan (§4c, 6 пунктов) — проверено по коду, не по памяти

| # | Пункт | Проверка | Вердикт |
|---|---|---|---|
| 1 | P0-1 photo-upload endpoint | `listing.controller.ts:213` — `POST` мятит presigned PUT URL (комментарий "AUDIT4 B-1"); `listing.service.ts:1176-1195` вызывает `storage.presignUpload`. | **✓ доехал** |
| 2 | P0-2 view-count вне ETag-базы | `listing.service.ts:123,365,1321-1322` — новая колонка `content_updated_at` (мигр. 0035), `weakEtag` строится из неё, а не из `updated_at`; захват просмотра (`captureView`) НЕ трогает `content_updated_at` — комментарий строки 1321 прямо это объясняет. | **✓ доехал** |
| 3 | P1-5 N-1 rolling-deploy safety | `docs/06-operations/runbooks/migration-deploy-order.md` (94 строки, конкретные примеры небезопасных миграций 0028/0029/0033) существует; миграции 0034/0036/0037/0038 сами носят в комментариях явные метки "N-1-SAFE"/"N-1-safe" (дисциплина стала практикой). **НО**: `.github/workflows/ci.yml` содержит `migration-drift` (идемпотентность×2) и `migration-backfill` (заполненная таблица), **нет** job'а "старый код + новая схема" — сама N-1-проверка процессуальная (ранбук), не автоматический CI-гейт. | **⚠ частично** — раннер/дисциплина есть, автоматический гейт — нет |
| 4 | P1-6 + agent-auth ADR | `backend/src/lib/auth/ability.factory.ts:46-134` — для AGENT `effective = matrix(role) ∩ scope`, `manage:all` структурно недостижим (проверено кодом, не только комментарием мигр. 0038); `agent_capability_profiles` (мигр. 0038 §B) + `service_credentials` (§A) — issuance построен, `feature_toggles.agent_service_auth=OFF` (мастер-гейт выключен намеренно). | **✓ доехал** (форма; поведение намеренно за тумблером — честно) |
| 5 | P3-2 saved-search→notify | `SavedSearchMatchConsumer` (мигр. 0037) — второй `OUTBOX_CONSUMERS`, идемпотентный ключ `saved_search_matched:<ssId>:<listingId>`; коммит `c44874c` (H4 follow-ups) добавил `q`-подстроку и `SavedSearch.Matched` аналитик-событие. | **✓ доехал, ещё и доработан (H4)** |
| 6 | P3-1 reputation/confirmed-sale primitive | `confirmed_sales` (мигр. 0039, ADR-0038) + `reviews`/`reputation_aggregates` (мигр. 0040, ADR-0039) построены; **намеренно DORMANT** — ни один эндпоинт их не читает/не пишет вручную, `feature_toggles.reputation_reviews=OFF`, `feature_toggles.sale_buyer_confirmation=OFF`. | **✓ форма доехала, поведение честно за тумблером (не силентный дроп — комментарии мигр. 0039/0040 сами это объявляют)** |

**Число: 5/6 доехали полностью (включая один пункт — форма-сейчас/поведение-потом, задокументировано
как таковое), 1/6 (N-1) — доехал наполовину (процесс, не автоматика).** Это совпадает с
"честным деферралом", не силентным дропом — за одним исключением из §2.

---

## 4. Ecosystem Expansion (`future-features.md` §Ecosystem) ↔ заложенные швы

Проверены 5 швов, названных в `future-features.md` §F "Form-now (anti-rewrite)":

| Шов | Статус | Свидетельство |
|---|---|---|
| Polymorphic offering key (`offering_type`/`offering_id`) на favorites/saved_searches | **✓ построен** | Мигр. 0032 (ADR-0014 D2) |
| `market_scope` на offering-абстракции | **✗ не построен, корректно отложен** | Нет колонки нигде в `database_schema.sql`; §F сам явно относит это к "Deferred… the real ServiceOffering/ProductOffering… tables" — ждёт появления самих сторон, честный деферрал |
| `geo_anchor` (point-form) | **✓ реконсилирован на уровне ADR** (не колонка ещё) | `traceability-matrix.md:45` — "`geo_anchor` / near-me endpoint reconciliation (point-form; PostGIS gated) — ✅ reconciled" — т.е. решение принято, физическая колонка ждёт discovery read-model (тот же ServiceOffering-барьер) |
| `monetization_type` (per-side) | **✗ не построен, корректно отложен** | Тот же барьер — ждёт первой платной вертикали |
| ADR-0014 внутреннее противоречие ("ships now" vs "not now"), флаг AUDIT3 | **✓ РАЗРЕШЕНО** | `docs/04-decisions/0014-offering-supertype-polymorphic-seam.md:117-124` — явная clarification-секция, цитирует именно AUDIT3, разграничивает "reference shape ships now" (сделано) от "subtype tables/read-model — not now" |

**Апекс-требование о трассировке экосистемы (AUDIT3 MAJOR: "ecosystem apex-BR не долетает до
BR-ID уровня").** Проверка `docs/specs/traceability-matrix.md` (v1.4, 2026-07-07) строки 50-52:
документ теперь **сам честно объявляет** этот пробел — "formal apex business-requirement rows
(BR-018+) … do not yet exist — the vision is tracked as ADRs, not yet as numbered BRs. This is a
decision-tier gap flagged for **architect**". Это не решение проблемы (нумерованных BR всё ещё
нет), но она перестала быть **силентной**: матрица прямо называет её, называет владельца
(architect) и причину. **Вердикт: улучшение с MAJOR silent-gap до explicitly-tracked-open-item.**

---

## 5. Сэмпл ≥10 утверждений из `docs/02-requirements/` — верно/протухло сегодня

| # | Файл:строка | Утверждение | Вердикт | Комментарий |
|---|---|---|---|---|
| 1 | `identity-domain.md:18` | "End-user authentication is passwordless" | **ВЕРНО** | Реализовано, DTO/контракт/схема согласны |
| 2 | `identity-domain.md:174` | 7-ролевой канон `{USER,MODERATOR,ADMIN,BREEDER,FARMER,VETERINARIAN,GROOMER}` | **ВЕРНО** | Совпадает с `database_schema.sql:115` дословно |
| 3 | `identity-domain.md:151-157` (UC-ID-05) | "Login history… Active sessions management (terminate)… Security alerts for new device" | **ПРОТУХЛО (частично)** | `refresh_tokens` несёт форму (`ip_address/user_agent/last_used_at`, мигр. 0020) без единого read/terminate-эндпоинта; BR не помечен как частично нереализованный |
| 4 | `admin-domain.md:20-21` | "Traits & Descriptors… Animal Statuses" перечислены как reference-датасеты наравне с species/breeds | **ПРОТУХЛО** | Схема (`:1509`) явно решила иначе — free-text JSONB / CHECK-enum, не датасет; BR не отражает решение |
| 5 | `admin-domain.md:196-197` data-model таблица `reference_data(dataset, code, name_localized, sort_order, metadata, …)` как единая таблица | **ПРОТУХЛО** | Реально: 5 отдельных INT-таблиц под единым CRUD-реестром (spec 06); BR описывает архитектуру, которой нет |
| 6 | `animal-domain.md` (было: "смена владельца запрещена в MVP") | — | **ВЕРНО (обновлено)** | ADR-0013 ратифицировал transfer, BR переписан |
| 7 | `pet-marketplace.md:72` / `livestock-marketplace.md:77` | Авто-EXPIRED через 60/90 дней | **ВЕРНО** | `retention.service.ts` (мигр.-независимый cron) реализует буквально это |
| 8 | `pet-marketplace.md:254` / `organization-domain.md:76-78` | Seller/org-аналитика ("Views: 15, Contacts shown: 3") | **ВЕРНО** | `/listings/{id}/analytics` + `/organizations/{id}/analytics` в контрактах, `view_count` реален (мигр. 0031) |
| 9 | `livestock-marketplace.md:26-29,194-199` | `price_or_terms` как VARCHAR со свободными формулировками цены | **ПРОТУХЛО, БЕЗ ПОМЕТКИ** | См. §2 — единственный найденный silent-drop этого раунда |
| 10 | `organization-domain.md:44` (было: `role_in_org` включает MODERATOR) | — | **ВЕРНО (обновлено)** | 4-ролевой канон, явная триплета |
| 11 | `docs/specs/traceability-matrix.md:27` (BR-016, favorites "MVP") | Favorites — MVP-функция | **ВЕРНО (было ПРОТУХЛО в AUDIT3)** | `backend/src/modules/favorite/*` полностью построен; ранее это был CRITICAL silent-drop раунда 3, сейчас закрыт |
| 12 | `identity-domain.md` / `pet-marketplace.md` — "connect two humans" (contact-reveal write-path), BLOCKER в AUDIT3 | Продавец может указать contactPhone/Telegram | **ВЕРНО (было ПРОТУХЛО/BLOCKER в AUDIT3)** | `identity.dto.ts:151-169` — `contactPhone`/`contactTelegram`/`showPhone` теперь есть на `PATCH /me` |

**Число: 12 утверждений сверено; 8 верны фактически (из них 2 — верны СЕГОДНЯ, но были
подтверждённо ложны/протухшими ещё в AUDIT3/4 и с тех пор закрыты — №11, №12), 4 протухли
(№3 частично, №4, №5, №9), из них №9 (GAP-BA-001) — единственная без какой-либо трек-пометки.**

---

## Итоговая сводка — топ-находки

| # | Severity | Антарая | Документ | Образец |
|---|---|---|---|---|
| 1 | **CRITICAL** (silent-drop apex-закона) | `стьяна` (объявление [CRITICAL, дважды] есть, действия нет — месяц простоя при активной соседней разработке) | `livestock-marketplace.md:26-29,194-199` + `pet-marketplace.md:25-27,170-192` + `database_schema.sql:270` | `price_or_terms: "50000 per straw"` в BR vs единственная колонка `price_cents BIGINT` в схеме — stud_service/leasing нельзя листить как задумано, ни одной GAP-пометки нигде |
| 2 | **MAJOR** (доверие к контрольному документу) | `прамада` (небрежность: 9 из 14 находок в ledger давно закрыты кодом/BR, но никто не вернулся его подтвердить — данные были, факт правки BR лежал в git log) | `REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md` (шапка `lastUpdated: "2026-06-30"`) | GAP-TRACE-004/006/008/009/010/011/012 отмечены ⚠️/❌ в документе, при этом соответствующие BR-доки несут собственные нормативные врезки "✅-по-факту" с явной ссылкой на тот же GAP-ID |
| 3 | **MINOR** (BR↔spec расхождение, не силентно на уровне архитектуры) | `прамада` (spec 06 и `database_schema.sql`-комментарий знают верное решение — BR-документ не подтянут) | `admin-domain.md:16-24,175-197` vs `docs/specs/06-admin-domain.md:69-89` | admin-domain.md всё ещё рисует единую generic `reference_data(dataset, code,…)` таблицу; фактическая архитектура — реестр из 5 отдельных INT-таблиц (GAP-TRACE-001/002) |
| 4 | **MINOR** (частично живой gap, не дефект по сути) | `алабдха-бхумикатва` (ступень взята частично: PII-at-rest и MFA-честность закрыты, но session-list/terminate/alerts всё ещё "форма без поведения" без пометки в самом BR) | `identity-domain.md:151-157` (UC-ID-05) vs `refresh_tokens` (мигр. 0020) | "Active sessions management (terminate specific sessions)" обещано в acceptance criteria; эндпоинта нет, колонки есть |
| 5 | **INFO** (позитивная находка — улучшение с прошлого раунда) | — | `docs/specs/traceability-matrix.md:50-52` | Экосистемный BR-нумерации пробел (AUDIT3 MAJOR) теперь явно и честно объявлен в самой матрице с владельцем (architect) — из silent-gap стал tracked-open-item |

**Общий счёт по разделам:** REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md — 3 точны / 9 протухли (в
пользу проекта — уже исправлено) / 2 живы честно, из 14. AUDIT4_HARDENING forward-plan — 5/6
доехали, 1/6 наполовину (N-1 CI-гейт). Ecosystem-швы — 2/5 построены, 3/5 корректно ждут barrier
(ServiceOffering), внутреннее противоречие ADR-0014 разрешено. BR-сэмпл — 8/12 верны, 4/12
протухли, из них **ровно один (GAP-BA-001) — истинный, не затрекованный silent-drop** и остаётся
единственным пунктом, требующим действия по апекс-закону "ничего не теряется молча".

---

## Границы соблюдены
- Правил только этот отчёт (`AUDIT5/senior-business-analyst.md`); `AUDIT5/_AXIS_ASSIGNMENT.md` не
  трогал (читал только).
- Не коммитил, тесты не гонял.
- `git status` в конце — чист кроме нового `AUDIT5/senior-business-analyst.md` (плюс
  предсуществовавшие незакоммиченные изменения `.claude/*`, не мои — не трогал).
