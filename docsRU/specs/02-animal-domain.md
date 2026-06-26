---
version: "1.2"
lastUpdated: "2026-05-28"
author: "Системный аналитик"
status: "Approved"
---

# Спецификация: Домен животного

## Результат
Управление основной сущностью животного как агрегатным корнем, представляющим домашних животных и скот. Обеспечить создание, обновление и извлечение записей о животных, включая породу, вид, возраст, состояние здоровья и право собственности. Обеспечить целостность данных и соответствие российским правилам идентификации и отслеживания животных.

## Область и границы
**Включает:**
- Животное как агрегатный корень с глобальным уникальным идентификатором (UUID)
- Атрибуты: вид (собака, кошка, крупный рогатый скот и т.д.), порода, кличка, дата рождения, пол, цвет/окрас, отметины, медицинские записи (JSONB: вакцинации, лечения), репродуктивные данные (JSONB: циклы течки, спаривание), история владения
- Жизненный цикл: создание (владельцем/заводчиком), обновление, архивирование (не удаление для соответствия требованиям)
- Отношения: одно животное может иметь несколько объявлений (продажа, разведение, выставка)
- Интеграция с доменом идентификации (ссылка на владельца)
- Правила валидации на основе вида/породы (например, крупный рогатый скот требует бирку для ушей)
- Соответствие российской идентификации животных (ID микрочипа для домашних животных, ID татуировки/клейма для скота) и 152-ФЗ для персональных данных владельцев

**Исключает:**
- Отслеживание генетического происхождения (родословная) - отложено на этап 2
- Ветеринарные медицинские записи (подробная история здоровья) - отложено
- Отслеживание перемещения животных (для скота) - отложено
- Системы аукционов/торгов - отложено

## Ограничения
- **Юридическое:** Должно соответствовать ветеринарному законодательству РФ, законам об идентификации животных (например, Федеральный закон "О ветеринарной медицине") и 152-ФЗ для данных владельцев.
- **Целостность данных:** Предотвращение дублирования записей о животных (уникальность микрочипа/бирки для ушей, где применимо).
- **Расширяемость:** Поддержка будущих атрибутов через JSONB или расширяющие сущности без изменений схемы.
- **Производительность:** Поиск животного по микрочипу/ID < 500мс.
- **Масштабируемость:** Поддержка 1M+ записей о животных.
- **Технологии:** Должно соответствовать выбранному стеку (NestJS, TypeScript, PostgreSQL).
- **Удобство использования:** Интерфейс должен направлять пользователей при сложном вводе атрибутов (зависимые от вида поля).

## Предыдущие решения
- Животное является агрегатным корнем с UUID как первичным ключом.
- Виды и породы являются справочными данными (управляются через домен администрирования).
- Право собственности связано с доменом идентификации (Пользователь) через отношение многие-к-одному (одно животное имеет одного текущего владельца, но мы отслеживаем историю владения).
- Атрибуты животных зависят от вида; мы используем комбинацию фиксированных столбцов и JSONB для расширяемых атрибутов.
- Российские правила требуют отслеживания ID микрочипа (для домашних животных) и бирки для ушей/паспорта (для скота).
- Мы храним минимальные персональные данные владельца в таблице Animal (только ссылка на userId) для соответствия 152-ФЗ; полные данные владельца находятся в домене идентификации.

## Трассируемость НФТ
Эта спецификация охватывает следующие нефункциональные требования:
- **Производительность (НФТ-ПРОИЗВ)**: Поиск животного по микрочипу возвращает результат за <500мс с 100k записями (см. docs/02-requirements/nfr/performance.md)
- **Безопасность (НФТ-БЕЗОП)**: Отсутствие дублирования персональных данных владельца в таблице животных для соблюдения 152-ФЗ (см. docs/02-requirements/nfr/security.md)
- **Доступность (НФТ-ДОСТУП)**: Интерфейс управления животными следует рекомендациям WCAG 2.1 AA (см. docs/02-requirements/nfr/accessibility.md)

## Разбивка задач
1. **Бэкенд (NestJS)**
   - [ ] Создать модуль `animal`
   - [ ] Определить сущность Animal с полями: id (UUID), speciesId, breedId, name, dateOfBirth, sex, color, markings, microchipId, earTagId, passportNumber, healthStatus (JSONB), currentOwnerId (ВНЕШНИЙ КЛЮЧ к Пользователю), ownedSince, motherId, fatherId, deactivatedAt, createdAt, updatedAt, archivedAt
   - [ ] Создать справочные таблицы для Видов и Пород (управляются через домен администрирования)
   - [ ] Реализовать правила валидации на основе вида (например, если вид=крупный рогатый скот, earTagId обязателен)
   - [ ] Создать AnimalController (операции CRUD, поиск по микрочипу/бирке для ушей)
   - [ ] Создать AnimalService (логика бизнеса: валидация, передача собственности [упрощённый прямой флоу по ADR-0013 — см. секцию round-6], архивирование)
   - [ ] Создать AnimalRepository (используя Prisma)
   - [ ] Настроить индексы базы данных: microchipId, earTagId, speciesId+breedId
   - [ ] Написать модульные и интеграционные тесты для жизненного цикла животного
   - [ ] Создать документацию OpenAPI для конечных точек животного

2. **Фронтенд (React)**
   - [ ] Создать страницы управления животными: Добавить животное, Редактировать животное, Просмотреть животное
   - [ ] Реализовать динамическую форму, которая изменяет поля в зависимости от выбранного вида/породы
   - [ ] Реализовать ввод микрочипа/бирки для ушей с валидацией
   - [ ] Создать компонент карточки животного для объявлений
   - [ ] Интегрировать с доменом идентификации для отображения информации о владельце (без ненужного раскрытия персональных данных)
   - [ ] Написать модульные и end-to-end тесты для потоков работы с животным

3. **Инфраструктура**
   - [ ] Убедиться, что PostgreSQL имеет расширение для UUID и JSONB
   - [ ] Настроить схему Prisma для Animal, Species, Breed
   - [ ] Добавить триггеры базы данных для ведения журнала истории владения (опционально, может обрабатываться в слое сервиса)
   - [ ] Настроить аудио-трейл для изменений животного (для соответствия требованиям)
   - [ ] Реализовать политики хранения данных GDPR/152-ФЗ (архивирование vs удаление)

## Критерии верификации
- [ ] Модульные тесты >90% покрытия для модуля животного (backend)
- [ ] Интеграционные тесты покрывают: создание животного (валидное/невалидное в зависимости от вида), обновление, передача собственности, поиск по микрочипу/бирке для ушей, архивирование
- [ ] End-to-end тесты покрывают: пользователь добавляет животное с полями, зависящими от вида, просматривает животное, редактирует животное
- [ ] Ручное тестирование: проверка ограничения уникальности микрочипа, валидация, зависящая от вида
- [ ] Производительность: поиск животного по микрочипу возвращает результат за <500мс с 100k записями
- [ ] Соответствие: модель данных поддерживает требования российской идентификации животных; персональные данные владельца не дублируются в таблице животных
- [ ] Документация: спецификация OpenAPI сгенерирована и доступна
- [ ] Дополнительные поля: Проверить, что поля ownedSince, motherId, fatherId, deactivatedAt правильно реализованы и протестированы
- [ ] Трассируемость НФТ: проверить, что требования производительности, безопасности и доступности корректно учтены и документированы

---

## Целостность родословной и JSONB-контракты (раунд 4, нормативно)

**Целостность родословной** (триггер `trg_enforce_pedigree_integrity`, миграция 0008):
- Животное не может быть своим родителем; **без циклов** (не может быть своим предком; проверка до глубины 64).
- `mother_id` → **Female** того же вида, рождённая **раньше** потомка; `father_id` → **Male**, те же правила.
- `mother_id`/`father_id` = NULL означает «неизвестный/внешний предок» (внешние номера — в `pedigree_id`; полноценная
  модель внешнего предка — Фаза 2+).
- Деактивированные животные остаются в родословной потомков (целостность линии), но исключаются из breeding-поиска (`is_active`).

**Контракты JSONB-полей** (каждое — JSON **массив**; валидировать `jsonb_typeof='array'` + форму элемента в сервис-слое):
- `health_records`: `[{ "type": "vaccination|treatment|checkup", "date": "YYYY-MM-DD", "note": str, "vet": str? }]`
- `reproductive_data` (самки): `[{ "event": "heat|mating|pregnancy|birth", "date": "YYYY-MM-DD", "details": obj? }]`
- `health_test_results`: `[{ "test": str (HD|ED|PRA|DNA…), "result": "clear|carrier|affected|<value>", "date": "YYYY-MM-DD", "lab": str? }]`
- `show_titles`: `[{ "title": str, "show": str?, "date": "YYYY-MM-DD"?, "country": str?, "rank": str? }]`

**Цвет/окрас — дискретный атрибут** (раунд 5, нормативно): цвет/окрас хранится в структурированном столбце
`color_coat VARCHAR(100)` и предоставляется API как отдельное поле **`colorCoat`** (camelCase ↔ столбец БД `color_coat`
в snake_case, API_CONVENTIONS §12). Он **не** сворачивается в свободный текст `description_localized` /
`descriptionLocalized`. Поле **изменяемое** (патчится через `AnimalUpdate`, в отличие от неизменяемых species/sex/DoB)
и необязательное/nullable.

**Прочее:** `microchip_id`/`tattoo_brand_id` **уникальны** (миграция 0004) — заменяет прежнее «warned, not enforced»;
формат чипа — ISO-11784/85 (15 цифр, валидируется в сервисе). Исправление неизменяемого поля (species/sex/DoB) —
через admin-процедуру с аудитом (не self-service). `breed_id` можно один раз нормализовать custom (NULL) → directory (миграция 0008).

## Передача владения — правила MVP (round-6, нормативно)

Передача владения **входит в MVP** как **упрощённая прямая передача** — ратифицирована
[ADR-0013](../04-decisions/0013-mvp-ownership-transfer.md), разрешая GAP-TRACE-007 в сторону апекс-бизнес-требования
(`../02-requirements/business-requirements/animal-domain.md:56-61`). Это отменяет любую прежнюю формулировку
«смена владельца заблокирована в MVP».

**Флоу.** **Текущий владелец** животного инициирует передачу **получателю** (существующему **пользователю ИЛИ организации**)
→ получатель **принимает** или **отклоняет** → при **принятии**, в **одной транзакции**: `owner_id`/`organization_id`
животного атомарно переатрибутируются, строка `ownership_transfers` переходит `PENDING → COMPLETED` (выставляется
`completed_at`), и дописывается `animal_ownership_history` (закрыть прежний интервал `end_date`, открыть новый
`start_date`); обновляется `animals.owned_since`. Инициатор может **отменить** ещё `PENDING`-передачу; непринятая
передача **истекает** через **72ч** (lazy-on-read в MVP, без воркера). Отклонение / отмена / истечение → терминальное
**`CANCELLED`**.

**Контролируемый owner-lock (GUC).** Триггер owner-lock `trg_animals_immutable_and_owner` больше не блокирует любое
изменение `owner_id`/`organization_id` — он разрешает изменение **только** когда сервис передачи выставил
транзакционно-локальный GUC `app.ownership_transfer = 'on'` в той же транзакции (ADR-0013 §2). Вне этого пути lock
полностью в силе. Неизменяемые проверки `species_id` / `sex` / `date_of_birth` / `breed_id` **не изменены** (см. секции
round-4/round-5 выше); условной становится только ветка owner/org.

**Инварианты (MVP).**
1. Только **текущий владелец** (нынешний `owner_id` или авторизованный org-admin нынешнего `organization_id`) может инициировать.
2. **Получатель ≠ текущий владелец** (нет самопередачи).
3. **Максимум одна активная `PENDING`-передача на животное** (частичный уникальный индекс `UNIQUE (animal_id) WHERE status='PENDING'`).
4. При принятии: **атомарно** переатрибуция + `ownership_transfers.status=COMPLETED` + дозапись `animal_ownership_history` +
   обновление `animals.owned_since` — всё-или-ничего, под GUC.
5. Актор каждого действия (инициация / принятие / отклонение / отмена) снапшотится как `{actor_id, principal_type}`
   (HUMAN или AGENT — ADR-0006/0011); передачу может брокерить ИИ-агент без будущего переписывания.
6. `expires_at` выставляется при инициации (по умолчанию 72ч).

**Состояния MVP:** `PENDING`, `COMPLETED`, `CANCELLED`. Тяжёлый набор верификации (`IN_PROGRESS`, `FAILED`,
платёж/вет/юр./CITES, двустороннее подтверждение, эскроу) **отложен за `feature_toggles.ownership_transfer_verification`**
(по умолчанию off) — форма сохранена на существующих колонках `ownership_transfers`, поведение позже. Полный жизненный
цикл: [Стейт-машина передачи владения](statemachines/ownership_transfer_state_machine.md). Дельты схемы, нужные MVP-флоу
(статус `CANCELLED`, `from/to_organization_id`, `completed_at`, snapshot principal-type, `transfer_reason`, частичный
уникальный индекс), определены в ADR-0013 §3 и owed через бэкенд-миграцию.

**Контракт.** Готовый к сборке API-контракт — [transfers-api.yaml](../03-architecture/api-contracts/transfers-api.yaml)
(инициация `POST /animals/{id}/transfers`; accept/decline/cancel `POST /transfers/{transferId}/{action}`; чтение
`GET /transfers/{transferId}`; список `GET /transfers?role=initiated|incoming&status=…`). Свершившийся след читается через
существующий `GET /animals/{id}/ownership-history` (его схема `AnimalOwnershipHistory` расширена для org-владельцев —
`ownerId` nullable + `organizationId`, OQ-1 **решён = вариант (a)**, приземлён в миграции 0023).

### Состояния и переходы (MVP) — тестируемая таблица переходов

Состояния, используемые в MVP: **PENDING**, **COMPLETED** (терминальное), **CANCELLED** (терминальное). `IN_PROGRESS` /
`FAILED` зарезервированы для верифицированного флоу Фазы 2.

| # | От | Событие (триггер) | Guard | К | Эффект |
|---|---|---|---|---|---|
| T1 | `[*]` | инициация (`POST /animals/{id}/transfers`) | актор = текущий владелец (или org-admin владеющей орг.); получатель ≠ текущий владелец; получатель ровно один из user/org; нет другой активной PENDING для этого животного | `PENDING` | создать строку; `expiresAt = now()+72h`; snapshot `initiatedBy` |
| T2 | `PENDING` | принять (`POST /transfers/{id}/accept`) | актор = названный получатель (или org-admin to-org); `now() ≤ expiresAt` | `COMPLETED` | **атомарная txn**: переатрибутировать животное (GUC) + закрыть прежний интервал истории + открыть новый интервал + выставить `ownedSince` + выставить `completedAt` + snapshot `respondedBy` |
| T3 | `PENDING` | отклонить (`POST /transfers/{id}/decline`) | актор = названный получатель (или org-admin to-org) | `CANCELLED` | `terminalReason='declined'`; snapshot `respondedBy`; животное не изменено |
| T4 | `PENDING` | отменить (`POST /transfers/{id}/cancel`) | актор = инициатор (или org-admin from-org) | `CANCELLED` | `terminalReason='cancelled_by_initiator'`; животное не изменено |
| T5 | `PENDING` | истечение (lazy, при следующем чтении/действии) | `now() > expiresAt` | `CANCELLED` | `terminalReason='expired'`; животное не изменено; без воркера (OQ-2) |
| — | `COMPLETED` | терминальное | — | — | новый владелец может инициировать новую передачу |
| — | `CANCELLED` | терминальное | — | — | слот partial-unique PENDING свободен; можно инициировать новую передачу |

### Правила решений (Gherkin)

```gherkin
Feature: MVP ownership transfer

  Scenario: Current owner initiates a transfer to a user
    Given an animal owned by the authenticated principal
    And no active PENDING transfer exists for that animal
    When the principal POSTs /animals/{id}/transfers with toUserId = R (R is not the owner)
    Then a PENDING transfer is created with expiresAt = createdAt + 72h
    And initiatedBy is the snapshot {actorId, principalType} of the principal
    And the response is 201 with an ETag

  Scenario: Second initiate while one is PENDING is rejected
    Given an animal with an active PENDING transfer
    When any principal POSTs /animals/{id}/transfers for that animal
    Then the response is 409 with code TRANSFER_ALREADY_PENDING

  Scenario: Self-transfer is rejected
    Given an animal owned by the authenticated principal
    When the principal initiates a transfer whose recipient is itself
    Then the response is 422 with code SELF_TRANSFER

  Scenario: Ambiguous or missing recipient is rejected
    When initiate is called with both toUserId and toOrganizationId set
    Then the response is 422 with code RECIPIENT_AMBIGUOUS
    When initiate is called with neither toUserId nor toOrganizationId
    Then the response is 422 with code RECIPIENT_REQUIRED

  Scenario: Recipient accepts — atomic re-attribution
    Given a PENDING transfer addressed to the authenticated principal
    And now() is on or before expiresAt
    When the principal POSTs /transfers/{id}/accept with a matching If-Match
    Then in one transaction the animal owner is set to the recipient
    And the prior ownership-history interval endDate is closed
    And a new ownership-history interval is opened with startDate = today
    And the transfer becomes COMPLETED with completedAt set
    And the response is 200 with the new ETag

  Scenario: Non-recipient cannot accept
    Given a PENDING transfer addressed to principal R
    When a principal other than R (and not an admin of the to-org) POSTs /accept
    Then the response is 403 with code FORBIDDEN
    And the animal is not re-attributed

  Scenario: Accept after expiry is rejected and the transfer is expired lazily
    Given a PENDING transfer whose expiresAt is in the past
    When the recipient POSTs /accept
    Then the transfer is transitioned to CANCELLED with terminalReason = expired
    And the response is 409 with code TRANSFER_EXPIRED

  Scenario: Initiator cancels a pending transfer
    Given a PENDING transfer the authenticated principal initiated
    When the principal POSTs /transfers/{id}/cancel with a matching If-Match
    Then the transfer becomes CANCELLED with terminalReason = cancelled_by_initiator
    And the animal is not re-attributed

  Scenario: Acting on a terminal transfer is rejected
    Given a transfer in COMPLETED or CANCELLED
    When any party POSTs /accept, /decline, or /cancel for it
    Then the response is 409 with code TRANSFER_NOT_PENDING

  Scenario: Stale view on a state-transition POST
    Given a PENDING transfer
    When a party POSTs /accept|/decline|/cancel with an If-Match that no longer matches
    Then the response is 412 with code STALE_RESOURCE
    When the If-Match header is absent
    Then the response is 428
```

### Инварианты и негативные случаи (общий источник правды для backend-engineer + reviewer-qa)

Эта таблица разворачивает пронумерованные инварианты выше в явные негативные случаи, точку enforcement и
HTTP/код-ошибки, который ДОЛЖЕН порождать каждый отказ — чтобы бэкенд-тесты и QA-покрытие опирались на один список.

| # | Инвариант (ДОЛЖЕН выполняться) | Негативный случай (ДОЛЖЕН отклоняться) | Обеспечивается | Ошибка → HTTP / code |
|---|---|---|---|---|
| INV-1 | Только **текущий владелец** животного (нынешний `owner_id` или org-admin нынешнего `organization_id`) может инициировать. | Не-владелец инициирует. | сервис (объектная authz) | 403 `FORBIDDEN` |
| INV-2 | **Получатель ≠ текущий владелец** (нет самопередачи). | получатель резолвится в текущего владельца. | сервис | 422 `SELF_TRANSFER` |
| INV-3 | Получатель — **ровно один из** user/org; from-сторона аналогично. | оба заданы, или ни один. | сервис + DB CHECK ровно-одно-из | 422 `RECIPIENT_AMBIGUOUS` / `RECIPIENT_REQUIRED` |
| INV-4 | **Максимум одна активная PENDING на животное.** | вторая инициация при существующей PENDING. | DB `UNIQUE (animal_id) WHERE status='PENDING'` + сервис | 409 `TRANSFER_ALREADY_PENDING` |
| INV-5 | При принятии переатрибуция + обе записи истории + `ownedSince` + статус→COMPLETED + `completedAt` — **всё-или-ничего в одной txn** под `app.ownership_transfer`. | частичная запись (владелец сменился, но нет дозаписи истории). | одна DB-транзакция + триггер-GUC guard (ADR-0013 §2) | 500 `INTERNAL` (txn откатывается; без смены состояния) |
| INV-6 | Изменение `owner_id`/`organization_id` **только** через путь передачи (GUC выставлен). | прямой `UPDATE animals SET owner_id=…` вне txn. | DB-триггер raise | (не API-путь) DB exception |
| INV-7 | Иммутабельные `species_id`/`sex`/`date_of_birth`/`breed_id` остаются иммутабельными при передаче. | передача также мутирует иммутабельное поле. | DB-триггер (неизменённая ветка) | DB exception → surfaced |
| INV-8 | Только **названный получатель** (или admin to-org) может принять/отклонить. | другой принципал принимает/отклоняет. | сервис | 403 `FORBIDDEN` |
| INV-9 | Только **инициатор** (или admin from-org) может отменить. | не-инициатор отменяет. | сервис | 403 `FORBIDDEN` |
| INV-10 | Передача actionable только пока **PENDING**. | accept/decline/cancel на терминальной передаче. | сервис (state precondition) | 409 `TRANSFER_NOT_PENDING` |
| INV-11 | PENDING-передача после `expiresAt` **не принимаема**; истекает lazily при чтении/действии. | accept после `expiresAt`. | сервис (lazy-проверка) | 409 `TRANSFER_EXPIRED` (+ переход в CANCELLED/`expired`) |
| INV-12 | State-transition POST-ы требуют **свежий `If-Match`**. | конкурентный accept vs cancel; устаревший/отсутствующий ETag. | сервис ETag-сравнение | 412 `STALE_RESOURCE` / 428 (отсутствует) |
| INV-13 | Каждый акт снапшотит **актора-принципала** `{actorId, principalType}` (HUMAN/AGENT). | акт передачи сохранён без snapshot принципала. | сервис + схема (колонки `*_principal_type`) | n/a (инвариант времени записи) |
| INV-14 | След истории **append-only и без разрывов**: COMPLETED-передача закрывает ровно один открытый интервал и открывает ровно один новый. | accept, пропускающий дозапись или оставляющий два открытых интервала. | сервис внутри txn INV-5 | 500 `INTERNAL` (txn откатывается) |

**Доменные коды ошибок (расширяют API_CONVENTIONS §4):** `TRANSFER_ALREADY_PENDING` (409), `TRANSFER_NOT_PENDING` (409),
`TRANSFER_EXPIRED` (409), `SELF_TRANSFER` (422), `RECIPIENT_AMBIGUOUS` (422), `RECIPIENT_REQUIRED` (422); плюс
стандартные `STALE_RESOURCE` (412), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (400).

**RBAC (строка rbac-matrix.md "Animal ownership transfer", MVP нормативно):** USER (и breeder/farmer/vet/groomer) =
инициировать свою (как текущий владелец) / принять-или-отклонить входящую / отменить свою-инициированную; MODERATOR = R;
ADMIN = R/U (override). Строка применяется одинаково независимо от `principal_type` (ADR-0011 §7).

> **OQ-1 РЕШЁН (вариант (a)) — приземлён в миграции 0023.** `animal_ownership_history.owner_id` теперь **nullable**
> с nullable `organization_id` и CHECK ровно-одно-из `chk_aoh_owner_party` (зеркалит `animals.chk_animal_ownership`),
> поэтому org-owned интервалы записываемы. Org-способная форма `AnimalOwnershipHistory` из контракта теперь подкреплена
> схемой, и путь org-передачи разблокирован.
> **(round-7, нормативно) ЧТО:** OQ-1 закрыт = вариант (a); `animal_ownership_history.owner_id` → nullable + `organization_id` +
> exactly-one-of CHECK (миграция 0023). **ПОЧЕМУ:** схема (тир выше спеки) уже содержит дельту — спека отставала, помечая OQ-1
> «owed/open»; апекс-BR требует org-transfer в MVP, а контракт уже несёт org-capable форму. **ПОЧЕМУ ТАК ЛУЧШЕ:** одна правда
> по OQ-1 во всех артефактах (schema↔data-model↔спека↔контракт); org-owned интервалы истории фиксируются без переписывания;
> согласовано с ADR-0013 §3 (рекомендованный вариант (a)) и зеркалит `animals.chk_animal_ownership`.

> **(round-6, нормативно) ЧТО:** Добавлена нормативная секция MVP-правил передачи владения (упрощённый прямой флоу;
> получатель = user OR organization; контролируемый owner-lock через GUC `app.ownership_transfer`; 72ч lazy-expiry;
> история дополняется при completion; principal snapshot HUMAN/AGENT).
> **ПОЧЕМУ:** До сих пор спека описывала transfer лишь ссылкой на стейт-машину, которая помечала флоу как post-MVP; апекс-BR
> (animal-domain:56-61, GAP-TRACE-007) и [ADR-0013](../04-decisions/0013-mvp-ownership-transfer.md) требуют transfer в MVP.
> **ПОЧЕМУ ТАК ЛУЧШЕ:** Одна нормативная точка правды по transfer внутри домена; backend получает явные инварианты
> (single-active-PENDING, atomic completion, recipient≠owner) и фазовую границу (verification за toggle); сохраняется
> история/родословная (re-attribute, не re-register) — ради чего запрет и вводился.

## Связанные документы

- [Глоссарий](glossary.md)
- [ADR-0013: Передача собственности в MVP](../04-decisions/0013-mvp-ownership-transfer.md)
- [Стейт-машина передачи владения](statemachines/ownership_transfer_state_machine.md)
- [Таблица решений валидации видов](business_logic/species_validation_decision_table.md)
- [Animals API](../03-architecture/api-contracts/animals-api.yaml)
- [Домен pet-маркетплейса](03-pet-marketplace-domain.md)
- [Домен livestock-маркетплейса](04-livestock-marketplace-domain.md)
- [Домен организаций](11-organization-domain.md)
- [Бизнес-требования](../02-requirements/business-requirements/animal-domain.md)
- 🌐 EN-зеркало: [docs/specs/02-animal-domain.md](../../docs/specs/02-animal-domain.md)
