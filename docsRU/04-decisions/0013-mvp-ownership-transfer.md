# ADR-0013: Передача владения в MVP — упрощённая прямая передача, контролируемый путь owner-lock, отложенные шлюзы верификации

**Status**: Accepted
**Date**: 2026-06-26
**Amends/clarifies**: [ADR-0004](0004-animal-as-aggregate.md) (агрегат animal владеет правилами смены владельца), [ADR-0006](0006-ai-agents-operate-platform.md) / [ADR-0011](0011-agent-principal-actor-model.md) (передачу может инициировать/одобрить HUMAN или AGENT-принципал — применяется snapshot актора).
**Related**: [ADR-0002](0002-hard-split-markets.md), [ADR-0007](0007-orm-strategy.md) (SQL-канонический workflow БД), [ADR-0009](0009-mvp-vs-target-architecture.md) (модульный монолит), [ADR-0010](0010-nft-digital-assets-hooks.md) (прецедент form-now/behaviour-gated).

## Context and Problem Statement

Мы начинаем **Animal Slice 2 — передача владения + история**. Перед написанием кода нужно урегулировать **инверсию иерархии истины**:

- **Апекс-бизнес-требование (in-scope).** `docs/02-requirements/business-requirements/animal-domain.md:56-61` (GAP-TRACE-007, нормативно) утверждает, что передача владения **поддерживается** в MVP через формальный workflow, который переатрибутирует животное и записывает `ownership_transfers` + `animal_ownership_history` — явно **не** «создай новый профиль». Это апекс-требование и оно уже исправлено в BR.
- **Триггер схемы (блокирует это).** Функция `database_schema.sql` `trg_animals_immutable_and_owner` — **эффективное** определение это второй `CREATE OR REPLACE` на ~строке 1063 (выполняется последним, поэтому он канон) — `RAISE`s `'Changing ownership is not allowed during MVP phase.'` при **любом** изменении `owner_id` **или** `organization_id`. Это физически блокирует апекс-требование.
- **Стейт-машина (говорит post-MVP, моделирует тяжёлый флоу).** `docs/specs/statemachines/ownership_transfer_state_machine.md:6` MVP-замечание говорит, что флоу post-MVP; диаграмма моделирует тяжёлый `PENDING → IN_PROGRESS → COMPLETED` флоу за шлюзами `payment_confirmed` / `vet_check` / `legal_docs`.
- **rbac-matrix (говорит locked).** `docs/specs/security/rbac-matrix.md:63` — "Animal ownership transfer | initiate/confirm own (locked in MVP)".
- **Таблица существует, но заточена под тяжёлый флоу.** `ownership_transfers` (`database_schema.sql:508`, Prisma `schema.prisma:492`) имеет `from_user_id` / `to_user_id` / `status IN (PENDING,IN_PROGRESS,COMPLETED,FAILED)` / `from_confirmed` / `to_confirmed` / `payment_confirmed` / `failure_reason` / `expires_at`. `animal_ownership_history` (`database_schema.sql:219`) имеет `animal_id, owner_id, start_date, end_date, transfer_reason`. **API-контракта передачи пока нет** — в `animals-api.yaml` только `GET /animals/{id}/ownership-history`.

Владелец (пользователь) решил **форму** MVP: **упрощённая прямая передача**, а не тяжёлый двусторонний верифицированный флоу. Этот ADR ратифицирует эту форму, разрешает инверсию в сторону апекс-BR, решает schema-shaping изменение lock и передаёт чистые брифы alpha-analyst (контракт) и backend-engineer (код + миграция). Согласно `truth-hierarchy.md`, конфликт чинится **в сторону требования**, а не просто «чтобы артефакты совпали».

## Decision Drivers

1. **Апекс-бизнес-требование побеждает** — передача в scope MVP; lock схемы и две спеки — нижестоящие артефакты, которые должны измениться (truth-hierarchy.md).
2. **Form-now / behaviour-gated (правило фаз, `IMPLEMENTATION_PLAYBOOK.md §5`)** — тяжёлая верификация (`payment_confirmed`/`vet`/`legal`/`IN_PROGRESS`) отложена **за реальным gate**, а не удалена; форма таблицы уже её вмещает. Повторяет ADR-0010 (NFT hooks) и Payment-за-`feature_toggles`.
3. **Необратимость следа данных** — передача, переатрибутирующая животное, должна атомарно дописать `animal_ownership_history` (закрыть прежний интервал, открыть новый); пропущенная дозапись — невосстановимая потеря истории. Тот же класс драйвера, что ADR-0011 §1.
4. **Инварианты иммутабельности остаются в силе** — релаксируется только lock `owner_id`/`organization_id`; иммутабельность `species_id`/`sex`/`date_of_birth`/`breed_id` и существующее релаксированное правило нормализации породы (`trg_animals_immutable_and_owner` ~1063) ДОЛЖНЫ оставаться enforced. Релаксация должна быть **узкой и контролируемой** — не «owner_id теперь свободно изменяем».
5. **Agent-as-principal (ADR-0006/0011)** — передачу может инициировать/принять/переопределить HUMAN **или** AGENT-принципал; актор должен снапшотиться на записи передачи (`{actor_id, principal_type}`), согласованно с ADR-0011 §1/§6. Нет cross-column связи `principal_type ⟂ role` (ADR-0011 §7).
6. **Два рынка остаются раздельными (ADR-0002)** — правила передачи в MVP рыночно-агностичны (нет платежа/вет/юр.), поэтому per-market расхождение сейчас не вводится; отложенные шлюзы верификации — там, где позже будут жить различия рынка/юрисдикции.

---

## §1 — Ратификация передачи владения в MVP + форма упрощённой прямой передачи

**Decision:** Передача владения **входит в MVP** (разрешает GAP-TRACE-007 в сторону апекс-BR). Форма MVP — **упрощённая прямая передача**:

> Текущий владелец **инициирует** передачу животного получателю (существующему **пользователю** или **организации**) → получатель **принимает** или **отклоняет** → при **принятии**, в **одной транзакции**: `owner_id`/`organization_id` животного **атомарно переатрибутируется**, строка `ownership_transfers` переходит `PENDING → COMPLETED`, и дописывается `animal_ownership_history` (закрыть интервал прежнего владельца `end_date`, открыть интервал нового владельца `start_date`). Инициатор может **отменить** ещё `PENDING`-передачу; непринятая передача **истекает** после таймаута.

**Явно отложено за gate (форма есть, поведение позже):** тяжёлая фаза верификации — `IN_PROGRESS`, `payment_confirmed`, вет-проверка, юр./CITES-документы, эскроу, двустороннее `from_confirmed && to_confirmed` взаимное подтверждение-до-прогресса. Они остаются **смоделированными** в (теперь чётко помеченной) post-MVP секции стейт-машины, а существующие колонки таблицы **сохранены** как forward-compatible форма. MVP-флоу просто **не проходит через `IN_PROGRESS`** и **не обращается** к `payment_confirmed`.

**Механизм gate:** строка `feature_toggles` **`ownership_transfer_verification`** (по умолчанию **off** в MVP), повторяющая то, как гейтится поведение Payment/NFT (`feature_toggles.payments`, ADR-0010). Когда off → MVP прямой флоу (`PENDING → COMPLETED` при принятии). Когда on (Фаза 2) → фаза верификации активируется аддитивно, переиспользуя уже присутствующие колонки. **Переписывание схемы не требуется** для включения. (Тоггл — **форма**: бэкенд читает его; MVP поставляет его off.)

Это в точности следует паттерну ADR-0011: *необратимая/вынуждающая-переписывание форма сейчас (запись передачи, дозапись истории, snapshot актора, контролируемый путь lock); поведение за gate, по умолчанию безопасное MVP-значение.*

---

## §2 — Разрешение триггера: owner lock меняется с «блокировать всё» на «только контролируемый путь передачи»

Owner-lock должен измениться с **«блокировать любое изменение `owner_id`/`organization_id`»** на **«изменения `owner_id`/`organization_id` **только** через контролируемый путь передачи».** Иммутабельные проверки `species_id`/`sex`/`date_of_birth`/`breed_id` **не изменены**.

**Рассмотренные варианты**

### Option A: Транзакционно-локальный GUC-флаг, который выставляет сервис передачи, а триггер проверяет (Выбрано)
Сервис передачи, внутри той же транзакции, что переатрибутирует животное, выставляет транзакционно-локальную настройку Postgres — `SET LOCAL app.ownership_transfer = 'on'` (или `set_config('app.ownership_transfer','on', true)`). Триггер при изменении `owner_id`/`organization_id` разрешает его **iff** `current_setting('app.ownership_transfer', true) = 'on'`; иначе raise (сообщение обновлено с «not allowed during MVP» на «only through the ownership-transfer workflow»).

Pros:
- **Минимально, хирургически** — одна ветка в существующем триггере; проверки иммутабельных полей и вся структура триггера не тронуты.
- **`SET LOCAL` транзакционно-ограничен** — разрешение не может утечь в другой statement/соединение; вне транзакции передачи lock полностью в силе. Случайный `UPDATE animals SET owner_id=...` откуда-либо ещё по-прежнему заблокирован.
- Нет новой процедуры/роли/привилегии; работает с существующей Prisma+Kysely транзакцией, которую сервис уже открывает для атомарной переатрибуции + дозаписи истории.
- Forward-compatible: тот же флаг охраняет верифицированный путь завершения Фазы 2 без изменений.

Cons:
- Гарантия — «owner_id меняется только когда сервис opt-in», **а не** «только эта конкретная stored procedure может это сделать» — будущая raw-миграция могла бы выставить флаг. Приемлемо: задача триггера — остановить случайную/неаудируемую мутацию по app-пути, а не защищаться от суперпользователя, запускающего произвольный SQL (DB-workflow уже доверяет миграциям). **Инварианты §3 (дозапись истории, единственная активная передача, recipient≠owner)** обеспечиваются в сервис-слое + ограничениях таблицы, а не предполагаются из триггера.

### Option B: SECURITY DEFINER stored procedure `transfer_animal_ownership(...)` делает переатрибуцию
Единственная SQL-функция владеет апдейтом `owner_id`; триггер проверяет `current_user`/контекст, который выставляет только функция.

Pros:
- Переатрибуция проходит ровно через одну именованную DB-рутину; сильнейшая гарантия «только этот путь».

Cons:
- Заталкивает **бизнес-логику** передачи в БД (дозапись истории, валидация, snapshot актора, идемпотентность) — против ORM-стратегии проекта (ADR-0007: Prisma/Kysely в сервис-слое; SQL-функции зарезервированы для триггеров/целостности, не оркестрации).
- Сложнее тестировать/наблюдать, чем сервис-код; дублирует логику, уже живущую в NestJS; разрешение актора/принципала (ADR-0011) живёт в приложении, не в БД.
- Тяжелее эволюционировать при включении фазы верификации.

### Option C: Убрать ветку owner_id из триггера; полагаться только на сервис-слой
Убрать lock полностью; приложение — единственное, что меняет `owner_id`.

Cons:
- Убирает defense-in-depth: баг, плохая миграция или будущий неосторожный `UPDATE` мог бы молча переатрибутировать животное **без дозаписи истории** — ровно та невосстановимая потеря следа данных, о которой предупреждает драйвер #3. Весь смысл триггера — сделать «владелец сменился без прохождения передачи» невозможным. Отклонено.

**Decision: Option A** — транзакционно-локальный GUC (`app.ownership_transfer`), который сервис передачи выставляет, а триггер проверяет. Сохранить все проверки иммутабельных полей; условной становится только ветка owner/org.

**ЧТО (WHAT):** Изменить `trg_animals_immutable_and_owner` так, чтобы ветка изменения `owner_id`/`organization_id` делала raise **кроме** случая `current_setting('app.ownership_transfer', true) = 'on'`; обновить текст исключения на "Changing ownership is only allowed through the ownership-transfer workflow." Все остальные (`species_id`/`sex`/`date_of_birth`/`breed_id`) проверки не изменены.
**ПОЧЕМУ (WHY):** Апекс-BR требует контролируемой смены владельца; глухая блокировка ему противоречит, а удаление lock теряет defense-in-depth, гарантирующий, что каждая переатрибуция сопровождается дозаписью истории.
**ПОЧЕМУ ТАК ЛУЧШЕ (WHY-BETTER for the whole project):** Минимально возможная релаксация инварианта безопасности (одна условная ветка, транзакционно-ограниченная, leak-proof вне транзакции передачи); держит логику целостности в триггере, а оркестрацию в сервисе (соблюдает ADR-0007); тот же флаг прозрачно охраняет верифицированный путь Фазы 2 (без будущего переписывания триггера); нет новой роли/grant/процедуры. Более сильный SECURITY-DEFINER вариант отклонён за заталкивание бизнес-логики в БД против ORM-стратегии; no-lock вариант отклонён за потерю гарантии дозаписи истории. **Первое использование идиомы GUC `app.*` в этой кодовой базе — см. Implementation Notes для конвенции.**

---

## §3 — Жизненный цикл MVP `ownership_transfers`, замапленный на существующие колонки

**Состояния MVP, используемые сейчас:** `PENDING`, `COMPLETED` и терминальное **`CANCELLED`** (отмена инициатором / отклонение получателем / истечение). **`IN_PROGRESS` зарезервировано (Фаза 2)**; **`FAILED` зарезервировано для верифицированного флоу** (провал проверки верификации). Отклонение/отмена/истечение в MVP — это **не** "FAILED" (никакая верификация не провалена) — это `CANCELLED`. Это **реконсилирует** единый бакет `FAILED` стейт-машины, разделяя «стороны решили не продолжать» (`CANCELLED`, MVP) от «шлюз верификации провален» (`FAILED`, Фаза 2).

**Переходы (MVP):**
| От | К | Триггер | Guard |
|---|---|---|---|
| `[*]` | `PENDING` | инициация | инициатор — текущий владелец; получатель ≠ текущий владелец; нет другой активной `PENDING` для этого животного |
| `PENDING` | `COMPLETED` | получатель **принимает** | получатель — названный `to_*`; передача не истекла | атомарно: переатрибутировать животное + дописать историю + выставить `completed_at` |
| `PENDING` | `CANCELLED` | получатель **отклоняет** | получатель — названный `to_*` | записать `failure_reason='declined'` |
| `PENDING` | `CANCELLED` | инициатор **отменяет** | актор — инициатор | записать `failure_reason='cancelled_by_initiator'` |
| `PENDING` | `CANCELLED` | **истечение** | `now() > expires_at` (worker/lazy) | записать `failure_reason='expired'` |
| `COMPLETED` | `[*]` | терминальное | — |
| `CANCELLED` | `[*]` | терминальное (можно инициировать новую передачу) | — |

**Инварианты (MVP):**
1. Только **текущий владелец** (нынешний `owner_id` животного или авторизованный org-admin нынешнего `organization_id`) может инициировать.
2. **Получатель ≠ текущий владелец** (нет самопередачи).
3. **Максимум одна активная `PENDING`-передача на животное** за раз (вторая инициация при существующей PENDING отклоняется) — обеспечивается **частичным уникальным индексом** `UNIQUE (animal_id) WHERE status = 'PENDING'`.
4. При принятии **атомарно** (одна транзакция): переатрибуция животного (под GUC §2) + `ownership_transfers.status=COMPLETED` + дозапись `animal_ownership_history` (закрыть старый интервал `end_date`, открыть новый `start_date`) + обновление `animals.owned_since`. Всё-или-ничего.
5. Запись передачи снапшотит **актора-принципала** каждого действия (ADR-0006/0011): кто инициировал и кто принял/отклонил, каждый как `{actor_id, principal_type}`.
6. `expires_at` выставляется при инициации (таймаут по умолчанию — см. открытый вопрос OQ-2 для значения).

**Маппинг на СУЩЕСТВУЮЩИЕ колонки `ownership_transfers` + требуемые дельты:**

| Нужно MVP | Существующая колонка | Статус |
|---|---|---|
| животное | `animal_id` | ✅ есть |
| from (user) | `from_user_id` | ✅ есть |
| to (user) | `to_user_id` | ✅ есть |
| статус вкл. CANCELLED | `status` CHECK = `(PENDING,IN_PROGRESS,COMPLETED,FAILED)` | ⚠️ **ДЕЛЬТА — добавить `CANCELLED`** в CHECK |
| причина отклонения/отмены/истечения | `failure_reason` | ✅ переиспользовать (по смыслу «терминальная причина»; переименование колонки не нужно) |
| истечение | `expires_at` | ✅ есть |
| двустороннее ack (отложено) | `from_confirmed`/`to_confirmed` | ✅ сохранить как форму Фазы 2 (не используется в MVP прямом флоу) |
| платёж (отложено) | `payment_confirmed` | ✅ сохранить как форму Фазы 2 (не используется в MVP) |
| **передача ОРГАНИЗАЦИИ** | — | 🔴 **ДЕЛЬТА — отсутствует.** Животные могут быть org-owned (`animals.organization_id`), и BR говорит передача «user **или** organization». В таблице только `from_user_id`/`to_user_id`. **Добавить `from_organization_id`/`to_organization_id`** (nullable FK→`organizations`), с CHECK, что у каждой стороны **ровно одно** из user/org (повторяя `animals` chk_animals_owner). |
| **completed_at** | — | ⚠️ **ДЕЛЬТА — добавить** `completed_at TIMESTAMPTZ NULL` (когда передача финализирована; отлично от `updated_at`). |
| **snapshot актора** (principal_type инициатора/принимающего) | — | ⚠️ **ДЕЛЬТА — добавить** `initiated_by_principal_type`/`responded_by_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK IN (HUMAN,AGENT)` (паритет ADR-0011 §1/§6). `from_user_id` уже записывает *какой* пользователь инициировал; snapshot principal_type записывает *какого типа*. |
| **transfer_reason** (свободный текст, который даёт инициатор) | — | ⚠️ **ДЕЛЬТА — добавить** `transfer_reason TEXT NULL` (в `animals-api.yaml` уже есть поле `transferReason` на истории; передача, которая её породила, должна его нести). Повторяет `animal_ownership_history.transfer_reason`. |
| единственная активная PENDING | — | ⚠️ **ДЕЛЬТА — добавить** частичный уникальный индекс `UNIQUE (animal_id) WHERE status='PENDING'`. |

`animal_ownership_history` **достаточна как есть** для MVP (`animal_id, owner_id, start_date, end_date, transfer_reason`) — **без дельты колонок**. Заметьте, что она ключует владение по `owner_id` (пользователь); для **org-owned** животных семантика `owner_id` строки истории — **открытый вопрос (OQ-1)** — см. Open Questions. (Сегодня `owner_id` это `NOT NULL REFERENCES users`; у org-owned животного нет user-владельца. Это должно быть разрешено перед кодом org-передачи.)

**ЧТО:** Жизненный цикл MVP = `PENDING → {COMPLETED | CANCELLED}`; `IN_PROGRESS`/`FAILED` зарезервированы для Фазы 2; дельты колонок выше.
**ПОЧЕМУ:** Существующая таблица была заточена под тяжёлый флоу и **не содержит колонок org-передачи**, которых требует BR, и snapshot актора, которого требует ADR-0011; `CANCELLED` чисто разделяет «стороны остановились» от «верификация провалена».
**ПОЧЕМУ ТАК ЛУЧШЕ:** Переиспользует существующую таблицу и её колонки Фазы 2 (без выбрасывания), добавляет только то, что MVP действительно нужно, держит модель актора согласованной по всей платформе (ADR-0011) и делает инварианты single-active-PENDING и ровно-одно-из-user/org DB-enforced, а не только сервисными.

---

## §4 — Реконсиляции доков owed (doc-first; каждая несёт тройку)

Эти артефакты **ниже в иерархии истины**, чем BR, и должны быть приведены в соответствие. Каждое изменение несёт свою тройку WHAT/WHY/WHY-BETTER в коммите (по `doc-code-protocol.md`); EN↔RU должны зеркалиться (механическое зеркало делегируется **doc-keeper**).

1. **`docs/specs/statemachines/ownership_transfer_state_machine.md`** — переписать MVP-замечание (строка 6): передача **в MVP** как **упрощённый прямой флоу** (`PENDING → COMPLETED` при принятии, `PENDING → CANCELLED` при отклонении/отмене/истечении). Чётко пометить секцию `IN_PROGRESS`/платёж/вет/юр. как **Фаза 2, за gate `feature_toggles.ownership_transfer_verification`**. Добавить `CANCELLED` в диаграмму (терминальное MVP) и уточнить, что `FAILED` — терминальное провала верификации Фазы 2. *(alpha-analyst пишет нормативную детализацию состояний; doc-keeper зеркалит.)*
2. **`docs/specs/security/rbac-matrix.md:63`** — заменить "initiate/confirm own (locked in MVP)" на **реальные MVP-права передачи**: USER = инициировать свою (как текущий владелец) / принять-или-отклонить входящую / отменить свою-инициированную; MODERATOR = R; ADMIN = R/U (override). Строка применяется одинаково независимо от `principal_type` (ADR-0011 §7).
3. **`docs/specs/02-animal-domain.md`** — добавить секцию `(round-N, normative)`, специфицирующую MVP-правила передачи (состояния, переходы, инварианты из §3), ссылающуюся на этот ADR и стейт-машину. Обновить строку чеклиста реализации 59 («ownership transfer») на указание упрощённого флоу.
4. **`docs/02-requirements/business-requirements/animal-domain.md:56-61`** — уже исправлено (GAP-TRACE-007). **Подтвердить**, без дальнейших правок; этот ADR её ратифицирует.
5. **`REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md`** — пометить **GAP-TRACE-007 resolved** (BR исправлено + ADR-0013 ратифицирует + спеки реконсилированы).
6. **`docs/03-architecture/data-model.md`** + **`ZooLink_ERD.mmd`** — добавить дельты `ownership_transfers` (org-колонки, `completed_at`, snapshot principal_type, `transfer_reason`, статус CANCELLED, частичный уникальный индекс).

---

## §5 — Поверхность контракта для alpha-analyst

Эндпоинты, которые нужны упрощённому флоу (писать против `API_CONVENTIONS.md`; URI `/v1`; RFC7807 ошибки; `{actor_id, principal_type}` на актор-несущих ответах по ADR-0011 §6):

| Endpoint | Назначение | Актор / authz | Idempotency / concurrency |
|---|---|---|---|
| `POST /animals/{id}/transfers` | **инициировать** (body: получатель user или org, опц. `transferReason`) | вызывающий — текущий владелец (или org-admin владеющей орг.) | `Idempotency-Key` (24h); отклонить если активная `PENDING` существует (409) |
| `POST /transfers/{transferId}/accept` | получатель **принимает** → переатрибуция | вызывающий — названный получатель | `ETag`/`If-Match` на передаче (412/428) для защиты от двойного accept; атомарно |
| `POST /transfers/{transferId}/decline` | получатель **отклоняет** | вызывающий — названный получатель | `If-Match` |
| `POST /transfers/{transferId}/cancel` | инициатор **отменяет** PENDING | вызывающий — инициатор | `If-Match` |
| `GET /transfers/{transferId}` | прочитать одну передачу | инициатор, получатель, MODERATOR, ADMIN | `ETag` |
| `GET /transfers?role=initiated\|incoming&status=...` | список **моих** передач | аутентифицированный принципал | `page`/`limit` + `PageMeta` |
| `GET /animals/{id}/ownership-history` | **существует** — сохранить | владелец / MODERATOR / ADMIN | `ETag`/`Cache-Control` |

Ожидания по concurrency для спецификации: single-active-PENDING (409 при дублирующей инициации), accept идемпотентен под `Idempotency-Key`, истечение — lazy-или-worker (решить с вопросом про scheduled-expirer, OQ-2). Ответ accept несёт нового владельца и дописанный интервал истории.

---

## Decision (summary)

1. Передача владения **в MVP** как **упрощённая прямая передача** (`PENDING → COMPLETED` при принятии; `PENDING → CANCELLED` при отклонении/отмене/истечении). GAP-TRACE-007 resolved в сторону апекс-BR.
2. Триггер owner-lock релаксируется до **контролируемого пути** через **транзакционно-локальный GUC** `app.ownership_transfer` (Option A); иммутабельные проверки `species/sex/DoB/breed` не тронуты.
3. Тяжёлая верификация (`IN_PROGRESS`/платёж/вет/юр./эскроу/двустороннее-ack) **отложена за `feature_toggles.ownership_transfer_verification`** (по умолчанию off), переиспользуя существующие колонки таблицы как forward-compatible форму.
4. `ownership_transfers` получает дельту миграции: статус `CANCELLED`, `from/to_organization_id` (+ CHECK ровно-одно-из-user/org), `completed_at`, `initiated_by/responded_by_principal_type`, `transfer_reason`, частичный уникальный индекс на `(animal_id) WHERE status='PENDING'`.
5. Реконсиляции доков (§4) и поверхность контракта (§5) переданы doc-keeper / alpha-analyst; сервисные инварианты + негативные тесты — backend-engineer.

## Consequences

### Positive
- Апекс-требование удовлетворено; один канонический truth через BR↔ADR↔схему↔спеку↔контракт.
- Родословная/идентичность/аудит сохранены (переатрибуция, никогда не ре-регистрация); дозапись истории атомарна и охраняема триггером.
- Agent-ready: передачу может инициировать/принять HUMAN или AGENT-принципал, снапшоченный по ADR-0011 — без будущего переписывания, чтобы агент мог брокерить передачи.
- Верифицированная передача Фазы 2 включается аддитивно (feature toggle + уже присутствующие колонки), без переписывания схемы.

### Negative
- Дельта миграции на существующей таблице (новые колонки + расширение CHECK + частичный уникальный индекс) и правка триггера.
- Вводит идиому GUC `app.*` (новая конвенция для документирования и согласованного использования).
- Org-передача требует разрешения семантики `animal_ownership_history.owner_id` для org-owned животных (OQ-1) до поставки этого пути.

### Neutral
- MVP поставляет тоггл верификации **off**; поведения платёж/вет/юр. пока нет.
- `from_confirmed`/`to_confirmed`/`payment_confirmed` остаются как дремлющая форма Фазы 2.

## Open Questions (surface — не угадывать)

- **OQ-1 (architect, возможно owner) — `animal_ownership_history` для org-owned животных.** `owner_id` таблицы истории это `NOT NULL REFERENCES users`. У org-owned животных нет user-владельца. Варианты: (a) добавить nullable `organization_id` в `animal_ownership_history` + CHECK ровно-одно-из (повторяет `animals`); (b) записывать org-admin пользователя как `owner_id`; (c) ограничить MVP-передачу **user↔user только**, отложить org-передачу. **(a) — чистый, BR-согласованный выбор**, и я склоняюсь к нему, но это вторая дельта таблицы истории — флагирую до того, как backend строит. *Рекомендую (a); подтвердить.*
- **OQ-2 (owner/product) — таймаут истечения передачи.** Стейт-машина использует `PENDING_TIMEOUT_HOURS = 72`. Оставить 72ч для MVP? И истечение **worker-driven** (запланированная задача, связана с GAP-TRACE-012 listing-expirer) или **lazy** (вычисляется при чтении)? *Рекомендую 72ч + lazy-on-read для MVP, worker позже.*
- **OQ-3 (owner/legal) — нужен ли MVP-передаче только согласие получателя, или какой-либо KYC/agreement-запись?** Форма MVP — accept/decline без юр.-документа. Подтвердить, что юридический/регуляторный артефакт не требуется для смены владельца pet/livestock в MVP (отложенный шлюз `legal_docs` покрывает CITES/регулируемые виды позже). *Это бизнес/юридический выбор — за владельцем.*

## Related Decisions
- [ADR-0004](0004-animal-as-aggregate.md) — агрегат animal владеет правилами смены владельца; этот ADR определяет их для MVP.
- [ADR-0006](0006-ai-agents-operate-platform.md) / [ADR-0011](0011-agent-principal-actor-model.md) — snapshot актора `{actor_id, principal_type}` применяется к актам передачи.
- [ADR-0010](0010-nft-digital-assets-hooks.md) — прецедент «форма сейчас, поведение за feature toggle».
- [ADR-0007](0007-orm-strategy.md) — почему lock остаётся триггером, а оркестрация остаётся в сервисе (отклоняя Option B).
- [ADR-0002](0002-hard-split-markets.md) — рынки остаются раздельными; отложенная верификация — там, где правила рынка/юрисдикции позже разойдутся.

## References
- `docs/02-requirements/business-requirements/animal-domain.md:56-61` (GAP-TRACE-007, апекс-BR).
- `database_schema.sql` — `trg_animals_immutable_and_owner` (~663 первое опр., **~1063 эффективное опр.**), `ownership_transfers` (~508), `animal_ownership_history` (~219), `animals` chk_animals_owner (~233).
- `docs/specs/statemachines/ownership_transfer_state_machine.md`, `docs/specs/security/rbac-matrix.md:63`, `docs/specs/02-animal-domain.md`.
- `docs/03-architecture/api-contracts/animals-api.yaml` (существующий ownership-history GET + `transferReason`).
- `IMPLEMENTATION_PLAYBOOK.md §3` (DB-workflow), `§5` (phase-boundary / rewrite test); `agent-os/instructions/truth-hierarchy.md`, `doc-code-protocol.md`.

## Implementation Notes — конвенция GUC `app.*` (новая)
- Сервис передачи открывает транзакцию, выполняет `SELECT set_config('app.ownership_transfer','on', true)` (третий аргумент `true` = транзакционно-локально, эквивалент `SET LOCAL`), выполняет переатрибуцию животного + дозапись истории, коммитит. Флаг авто-очищается в конце транзакции — он не может утечь в другой statement, соединение или пулированную сессию.
- Триггер читает `current_setting('app.ownership_transfer', true)` (`true` = «отсутствует → NULL, не ошибка») и трактует всё, кроме `'on'`, как «заблокировано».
- Это **первый** кастомный GUC `app.*` в кодовой базе. Установить его как конвенцию для «сервис явно opt-in в нормально-заблокированную контролируемую мутацию»; задокументировать в `data-model.md`. Backend должен обеспечить, что `set_config` и мутация — в **одной** транзакции Prisma/Kysely.

🌐 EN canon: `docs/04-decisions/0013-mvp-ownership-transfer.md`
