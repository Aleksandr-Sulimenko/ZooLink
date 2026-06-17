# Аудит консистентности документации EN ↔ RU — ZooLink

**Дата:** 2026-06-16
**Метод:** покопийное сравнение содержимого `docs/` (EN, канон) и `docsRU/` (RU, зеркало) + чеклисты + специи. 7 параллельных подагентов, ~67 пар файлов.
**Статус:** канон `docs/` (EN) считается источником истины; `docsRU/` должен быть его точным зеркалом.

> TL;DR: расхождений много, но они группируются в **5 системных классов**. Самые опасные — перевод contract-идентификаторов и дрейф data-контрактов (ломают реализацию, а не только перевод). Плюс вскрылась upstream-проблема: часть «английского» канона на самом деле написана по-русски.

---

## 🔴 Системные проблемы (приоритет 1 — чинить первыми)

### S1. Перевод contract-идентификаторов в RU (ломает реализацию)
В RU переведены имена, которые ОБЯЗАНЫ быть байт-в-байт как в EN (это идентификаторы кода/контрактов, не проза):
- **State machines:**
  - `listing_state_machine.md` — DRAFT→ЧЕРНОВИК, PENDING_MODERATION→ОЖИДАНИЕ_МОДЕРАЦИИ, ACTIVE/EXPIRED/SOLD/DEACTIVATED переведены; триггеры APPROVE/REJECT/CONFIRMED тоже.
  - `user_state_machine.md` — UNVERIFIED/PENDING_VERIFICATION/VERIFIED/ACTIVE/SUSPENDED/DEACTIVATED + триггеры переведены.
  - `ownership_transfer_state_machine.md` — булевы литералы TRUE/FALSE→ИСТИНА/ЛОЖЬ в guard-условиях; плюс мусорный токен «как失败», опечатка «подтвержен».
- **`specs/11-organization-domain.md`** — роли/действия в decision-table: OWNER/ADMIN→ОВЛЕК/АДМИН, STAFF/VET/MODERATOR→СОТР/ВЕТ/МОДЕР, FULL_ACCESS/LIMITED_ACCESS/BASED_ON_ROLE переведены.
- **`species_validation_decision_table.md`** — имена состояний переведены и вдобавок внутренне несогласованы («НА МОДЕРАЦИИ» vs «ОЖИДАНИЕ_МОДЕРАЦИИ» из стейт-машины).
> **Правило фикса:** во всех RU-файлах вернуть оригинальные ENUM/состояния/булевы/ролевые константы как в EN. Переводить можно только человекочитаемые описания.

### S2. Дрейф data-контрактов EN↔RU (и противоречие с моделью данных)
- **`api-contracts/animals-api.yaml`** (HIGH): `species_id`/`breed_id` — EN `integer`, RU `string/uuid` (в двух схемах: create-request и entity). Контракты EN и RU расходятся.
- При этом **EN-контракт противоречит `data-model.md`**, где `species_id`/`breed_id` = UUID. Т.е. RU тут «правее» канона.
- **`specs/02-animal-domain.md`** (HIGH): набор полей сущности расходится — EN `nickname/colorCoat/tattooBrandId/healthRecords/reproductiveData/ownerId/organizationId`, RU `name/color/earTagId/passportNumber/healthStatus/currentOwnerId/archivedAt`. RU выдумал поля (microchip ID, sterilization) и **выкинул reproductiveData**.
- **`requirements/business-requirements/animal-domain.md`** (med): EN `species_id INT/breed_id INT` + `*_localized JSONB`; RU — UUID + не-локализованные VARCHAR.
> **Решение требует владельца:** сначала зафиксировать, INT или UUID для `species_id`/`breed_id`, и localized-JSONB или нет — затем выровнять `data-model.md`, оба yaml и спеку животных. **Открытый вопрос для пользователя.**

### S3. Часть «английского» канона написана по-русски (upstream)
Эти файлы лежат в `docs/` (EN-дерево), но фактически на русском; их «переводы» в `docsRU/` — байт-в-байт копии. Английского источника истины НЕТ:
- `01-discovery/mvp-scope.md`
- `03-architecture/data-model.md`, `domains-and-bc.md`, `storage.md`
- `04-decisions/README.md`
- `05-ui-ux/user-flows.md`
- `localization/approach.md`, `localization/migration-summary.md`
- `project-structure-map.md` (разделы 2–8 по-русски)
> Это не дефект перевода, а отсутствие EN-канона. Нужно решение: либо признать RU каноном для этих файлов, либо написать EN-версии.

### S4. RU-специи систематически теряют контент
- **Секция «User Stories» (UC-xx) выкинута в RU** у: `specs/04, 05, 06, 07, 08, 09` (по 3–5 use-case'ов в каждой).
- **`specs/glossary.md`** (HIGH): в RU отсутствуют 3 определения — **Health Records, Reproductive Data, Metadata** (JSONB-схемы + примеры). Усугубляет S2.
- **`traceability Matrix.md`** (med-high): в RU усечены списки UC в критериях верификации почти во всех строках (напр. BR-001 EN UC-ID-01..05 → RU только 01,02; BR-009 — все UC-TS выкинуты). Ломает полноту трассируемости.
- **`specs/09-testing-strategy.md`** (HIGH): раздел нагрузочного тестирования не переведён, а переписан — другие подсекции, другой инструмент (Artillery), **другие цифры** (EN 1000 users/1000 rps/95p<2s vs RU 100-200 rps).
- **`specs/10-implementation-roadmap.md`** (med): в RU «Definition of Done» потерял 2 пункта (синхронизация EN/RU + NFR Traceability).
- **`requirements/identity-domain.md`** (HIGH): RU отстал — нет ролей VETERINARIAN/GROOMER в ENUM и описаниях, выкинута вся секция User Stories (UC-ID-01..05), инвертирована логика в mermaid (`alt No existing user`→`Существует пользователь`).
- **`requirements/organization-domain.md`** (HIGH): RU отражает старую до-localization схему (name_ru/name_en VARCHAR обязательны вместо name_localized JSONB; нет description_localized/metadata).
- Прочий мелкий дроп фактов: `00-project-brief.md` (RU потерял блок Integrations), `pet-marketplace.md`/`matching-domain.md`/`integrations.md` (выкинуты org-поля, изменены owner/criticality в GAP-реестре).

### S5. Машинный перевод оставил инородные токены (массово, low/med)
Почти во всех RU-файлах — вкрапления чужих языков/мусора посреди слов: CJK («共享», «組織», «适用но», «失败»), иврит («ללא»), испанский («capacidad», «compartir», «Nunca»), польский («należących», «gdy»), итальянский («matrice», «servizi»), мояке («Хаverseине» = Haversine, «бизнесаyour text», «Удаление.account»). Полный список — в приложении A (по файлам). Лечится вычиткой/повторным переводом.

---

## 🟠 Отсутствующие файлы (приоритет 2)

| Файл | Где есть | Чего нет | Примечание |
|---|---|---|---|
| `02-requirements/database-audit-report.md` | EN | RU | релевантен дрейфу UUID/INT (S2) |
| `02-requirements/priority1-completion-summary.md` | EN | RU | summary, можно не переводить |
| `04-decisions/README.md` | EN | RU | при этом EN-файл сам на русском (S3) |
| `05-ui-ux/user-flows.md` + весь `05-ui-ux/` | EN | RU | EN-файл на русском (S3) |
| `localization/approach.md`, `migration-summary.md` | EN | RU | EN-файлы на русском (S3) |
| `project-structure-map.md` | EN | RU | EN-файл частично на русском (S3) |
| `03-architecture/containers.md` | RU | EN | проза C4-L2; на него ссылаются оба `system-context.md`, но в EN его нет → битая ссылка |

---

## 🟡 Битые ссылки и устаревшие решения (приоритет 2-3)

- **`runbooks/`** — каталог `docs/06-operations/runbooks/` упоминается в `monitoring.md`, `deployment.md`, `disaster-recovery-plan.md` (EN и RU), но **не существует**.
- **`containers.md`** — оба `system-context.md` ссылаются на C4-L2 `containers.md`, которого в EN нет (есть только `container-diagram.md`).
- **ADR-0001 (tech-stack) частично устарел:** его i18n-секция описывает en/ru + Format.js/i18next, тогда как `localization/approach.md`+`migration-summary.md` документируют уже внедрённый 5-язычный (ru/en/fr/es/zh) подход с DB-функциями (`get_localized`, `has_translation`, таблица `supported_languages`). Не противоречие, но ADR надо обновить/дополнить ссылкой. Остальные ADR (0002–0005) — Accepted, взаимно согласованы, не устарели.

---

## ⚪ Чеклисты EN↔RU и покрытие specs↔checklists (приоритет 3)

**Парность чеклистов (6 пар, все существуют):**
- OK: `DOCUMENTATION_CHECKLIST.md`, `FURTHER_IMPLEMENTATION_CHECKLIST.md`.
- `BUSINESS_ANALYSIS_CHECKLIST.md` (med): в RU отсутствует пункт i18n (EN 30 / RU 29 пунктов) + мусорные вставки.
- `ACCURACY_FIX`, `API-TECH-STACK`, `PENDING_DOCUMENTATION` (low): только инородные токены, контент совпадает, чекбоксы совпадают.

**Дыры покрытия (чеклисты — процессные, не по-доменные):**
- Сильно покрыт только `11-organization`. Домены `01–05` — лишь как побочка инициативы org-моделирования.
- **Нет покрытия:** `06-admin`, `07-geo-search`, `09-testing`, `10-roadmap`, `12-moderation`, `13-notification`, `14-payment`, плюс все вспомогательные специи (security, localization, performance, deployment, error_handling, business_logic, statemachines).
- **Дрейф путей в чеклистах:** ссылаются на `docs/02-requirements/business-requirements/*-domain.md`, которых нет — реальная раскладка `docs/specs/NN-*.md`. Часть пунктов помечена [x] для несуществующих путей (вкл. `ACCURACY_FIX #8` — заявляет наличие RU-зеркал специй, не подтверждается). Чеклисты надо сверить с реальным деревом.

---

## ✅ Что в порядке
- API-контракты (кроме animals): `admin/auth/branch/listings/matching/organization-api.yaml` — endpoints/схемы совпадают (RU = байт-в-байт копия EN, описания просто остались на английском — низкий приоритет).
- Архитектурные диаграммы: `component/container/deployment-diagram.md`, `system-context.md` — совпадают.
- Специи `12, 13, 14, 15` — числа и структура совпадают.
- Cross-cutting специи: `error_handling/standard_error_format.md` (все коды 4000-5999 совпадают), `security_specification.md`, `threat-model.md`, `performance_specification.md`, `localization_specification.md`, `deployment_specification.md`, `geo_search_eligibility.feature` (9 сценариев) — OK.
- `specs/01-identity-domain.md`, `specs/README.md`, discovery `problem-statement.md`/`target-audience.md` — OK.

---

## Известные баги самого EN-канона (чинить независимо от перевода)
- Порча «Facза 2 / Faza 2» вместо «Phase 2» в `assumptions.md`, `future-features.md`, `target-audience.md` (EN) — пропагандируется в RU.
- Дубликат кода ошибки **BRN-005** (на два разных случая) в error-таблице org-домена (EN), зеркалится в RU.
- Устаревшие деревья каталогов в `README.md` (EN и RU) не отражают реальную структуру.

---

## Рекомендованный план устранения (по приоритету)

1. **P1 / решение владельца:** зафиксировать тип `species_id`/`breed_id` (INT vs UUID) и политику localized-JSONB → выровнять `data-model.md`, `animals-api.yaml` (EN+RU), `02-animal-domain.md`, требования. *(S2)*
2. **P1 / механически:** вернуть в RU оригинальные contract-идентификаторы (состояния/enum/булевы/роли) в стейт-машинах, `11-organization`, `species_validation`. *(S1)*
3. **P1:** восстановить выкинутый контент в RU — User Stories (специи 04-09), 3 термина глоссария, UC в traceability matrix, DoD-пункты, нагрузочный раздел 09, роли/секции в identity/organization-требованиях. *(S4)*
4. **P2 / решение владельца:** по S3 — признать RU каноном для «русских EN-файлов» или дописать EN. Затем закрыть отсутствующие файлы (приоритет 2).
5. **P2:** починить битые ссылки (создать `runbooks/` или убрать упоминания; разрешить `containers.md` vs `container-diagram.md`); обновить i18n-секцию ADR-0001.
6. **P3:** вычитать инородные MT-токены (приложение A); синхронизировать чеклисты с реальным деревом `docs/specs/` и завести доменные acceptance-чеклисты для непокрытых доменов.

> Приложение A (пофайловый список инородных токенов и точных строк) доступно в выводах подагентов этой сессии — могу развернуть его в отдельный файл, если нужен рабочий чек-лист для вычитки.
