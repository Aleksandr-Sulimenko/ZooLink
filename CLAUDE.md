# CLAUDE.md — ZooLink (проект, фаза реализации)

Инженерный гид по самому проекту ZooLink. Воркспейс-уровень и **Agent Operating Model** — в корневом `../CLAUDE.md`; **полный протокол реализации — `IMPLEMENTATION_PLAYBOOK.md`** (обязателен в любой сессии с кодом). Здесь — то, что нужно держать под рукой, работая внутри `ZooLink/`.

## Что это и где ценность
ZooLink — маркетплейс по животным; два рынка жёстко разделены (ADR-0002): **pet** и **livestock**. Это git-репозиторий (ветка `backend`). Документация — **валидированный контракт**; код реализует контракт, не наоборот.

Фаза: **бэкенд-реализация**. **Фаза 0 (каркас + платформа) закрыта** — NestJS в `backend/`, `docker compose up` → зелёный `/health/ready`, CI активен. План и прогресс — `BACKEND_IMPLEMENTATION_PLAN.md`.

## Команда агентов (определения — `.claude/agents/*.md`)
`zoolink-architect` (ADR/дизайн/roadmap) · `alpha-analyst` (SDD-спеки) · `zoolink-backend-engineer` (код) · `zoolink-ux-designer` (UX: research/IA/flows/wireframes/interaction-logic/доступность/удовлетворённость/возврат) · `zoolink-ui-designer` (UI-крафт: дизайн-язык/токены/hi-fi компоненты/responsive/motion/воспринимаемая производительность — плавность/отзывчивость/без раздражения) · `zoolink-frontend-engineer` (Фаза 2, заглушка) · `zoolink-doc-keeper` (EN↔RU/консистентность) · `zoolink-reviewer-qa` (контроль/DoD/тесты) · `zoolink-devops` (Docker/CI/деплой). Главная сессия — оркестратор: состояние → план → делегирование → верификация по DoD → запись.

## Иерархия истины (не инвертировать)
**На вершине — бизнес-требования и идеи продукта** (`docs/00-project-brief/`, `docs/02-requirements/business-requirements/*`, видение ADR-0006): и документация, и код им служат — это не «код подчиняется докам», а оба подчиняются бизнес-цели. **Ни одна идея/требование не выпадает молча**: всё либо реализовано, либо явно затрекано (план/бэклог/ADR) с причиной; цель — все идеи в итоге реализованы.
Далее (для разрешения конфликтов между артефактами): **бизнес-требования** → ADR (`docs/04-decisions/NNNN-*.md`) → **`database_schema.sql`** (валидируется на живом PG) → **`API_CONVENTIONS.md`** (`docs/03-architecture/api-contracts/`) → доменные спеки (`docs/specs/NN-*.md`) → baseline'ы → код. Глоссарий: `docs/specs/glossary.md`. ERD-канон: `ZooLink_ERD.mmd`.
> Конфликт код↔док чиним в сторону **требования**, а не просто «чтобы совпало». См. [[business-requirements-are-apex]].

## DB-workflow (SQL-канон + Prisma introspect — ADR-0007)
Схема **не** генерится Prisma Migrate. Изменение БД = правка `database_schema.sql` + **идемпотентная** миграция `migrations/YYYYMMDD_NNNN_*.sql` + `ZooLink_ERD.mmd` + `docs/03-architecture/data-model.md` + счётчики таблиц в этом и корневом `CLAUDE.md`; прогон на живом PG **дважды** + **негативные тесты** инвариантов; затем `cd backend && npm run db:sync`. Доступ: Prisma (CRUD) + Kysely/`$queryRaw` (гео/рекурсивная родословная/JSONB). Сырой SQL — только параметризованный (ESLint-гард).
> Состояние БД: **31 таблица**, миграции `0001`–`0016` идемпотентны (`0011` = reference-seed, `0012` = outbox relay delivery-state: attempts/last_error/next_attempt_at/dead_lettered_at, `0013` = updated_at-триггеры выставляются по факту наличия колонки — снят ошибочный триггер с `outbox_events`/`animal_ownership_history`/`messages`, добавлен недостающий на `digital_assets`, `0014` = снят избыточный `idx_outbox_unprocessed`, `0015` = `users.erased_at` для ФЗ-152 erase_user, Identity Slice 4, `0016` = ADR-0011 A0a actor-snapshot: `actor_principal_type` на `audit_log`+`moderation_decisions`, `actor_role`/`supersedes_decision_id`/`is_human_override`+`chk_moddec_override` на `moderation_decisions`; гигиена `role_in_org` 4-канон — колонки, таблиц +0), ~два десятка инвариантов enforced. Reference + reasons/templates сидятся `npm run seed` (идемпотентно).

## API-конвенции (каждый эндпоинт — `API_CONVENTIONS.md`)
RFC7807 `application/problem+json` (`type/title/status/code`); `page`/`limit` + `PageMeta`; деньги — целые minor units; `Idempotency-Key` на небезопасных POST (24ч); `ETag`/`If-Match` на мутирующих PATCH (412/428); rate-limit на Redis + заголовки на чувствительных; `x-required-roles` по `docs/specs/security/rbac-matrix.md`; URI-версия `/v1`; публичные чтения — `ETag`/`Cache-Control`. Платформенные утилиты этого всего **уже есть** в `backend/src/lib` — переиспользовать.

## Сквозные требования
- **doc↔code:** нашёл неверный контракт → сперва правь документ (тройкой ЧТО/ПОЧЕМУ/ПОЧЕМУ-ТАК-ЛУЧШЕ), потом код, в одном изменении.
- **EN↔RU:** `docs/` (EN) — канон, `docsRU/` — точное зеркало (идентификаторы/числа/структура идентичны; переводится проза).
- **Границы фаз — по cost-of-change, не по ярлыку (forward-compat против ВСЕХ будущих фаз):** тащим в реализацию сейчас, если (1) это бизнес-требование (ИИ-агентная модерация/админ — ADR-0006, design-in), либо (2) отсрочка вызовет переписывание схемы/контракта/actor/authz на любой будущей фазе, либо (3) просто дёшево; откладываем лишь когда дешевле потом **И** нет риска переписывания **И** не бизнес-требование. **Agent-first:** код-фиксатор актёра — agent-ready с первого коммита (`actor_id`+`principal_type HUMAN|AGENT`+human-override+источник-агностичный principal). **Тест на переписывание — в DoD** (неясно → форму делаем сейчас). Необратимое — сейчас; поведение — за настоящими forward-compatible гейтами (Payment за `feature_toggles.payments` off — «форма есть, поведение отложено»). Полный критерий — `IMPLEMENTATION_PLAYBOOK.md §5`.
- **agent-as-principal (ADR-0006):** где фиксируется актёр (модерация, audit_log, админ-действия) — принципалом может быть ИИ-агент (`users.principal_type HUMAN|AGENT`); сохранять идентичность актёра, аудит и human-override.
- **Git:** ветка `backend`; коммит/пуш — только по явной просьбе пользователя.
- **RLM digest (тяжёлый кросс-док поиск/агрегация/дайджест):** инструмент `/home/asulimenko/Project/RLM/` — звать **только** когда контент не влезает в контекст или нужна агрегация по многим файлам/всему проекту (иначе нативный Read/grep — быстрее и надёжнее). ДО вызова: определи, **где живёт ответ** → влезает в окно → `direct` на этот док; не влезает → `run` по корпусу (+majority-of-3, run недетерминирован). Запуск с `RLM_CALLER=<имя-агента>` (трекинг), **спросить пользователя перед каждым запуском** (платно). **Канон правила/маршрутизации — `workspace/RLM-bench/DELEGATION_POOL.md`** (сводки: корневой `workspace/CLAUDE.md` RAG/RLM, память `rlm-delegation-rule`, хук `RLM/rlm-hook.sh`).

## Частые команды (из `backend/`)
`npm run start:dev` · `npm run worker:dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run db:sync` · `npm run seed`. Полный стек: `docker compose up -d --build` (из корня репо).

## Аудиты (читать перед правкой соответствующей области)
`PREDEV_READINESS_AUDIT.md` (BPMN/ER — готово) · `DATABASE_SCHEMA_AUDIT.md` · `EN_RU_CONSISTENCY_AUDIT.md` · `BUSINESS_LOGIC_CONSISTENCY_AUDIT.md` · `BACKEND_TECH_AUDIT.md` · `REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md` (BR↔спека/схема дрейф, GAP-TRACE-001..014; 🔴-блокеры перед Admin Slice 2-4) · `CAPABILITY_DIGEST.md` (код↔контракт↔спека↔схема по реализованным капабилити; ледджер DIV-1..9). Дальнейшая P1/P2-детализация — по доменам в ходе реализации (`IMPLEMENTATION_PLAYBOOK.md`).
