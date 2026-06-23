# ADR-0011: Модель актёра-агента (agent-principal) — снапшот действующего принципала, human-override и forward-совместимый service-auth

**Status**: Accepted
**Date**: 2026-06-23
**Amends**: [ADR-0006](0006-ai-agents-operate-platform.md) (не переписывает и не supersedes — добавляет конкретную форму записи актёра, которую ADR-0006 объявил «directional»).
**Related**: [ADR-0009](0009-mvp-vs-target-architecture.md) (модульный монолит), [ADR-0003](0003-pre-moderation-workflow.md), [ADR-0001](0001-tech-stack.md).

## Context and Problem Statement

ADR-0006 сделал ИИ-агентов полноправными принципалами (`users.principal_type HUMAN|AGENT`) directional, baked-in решением, но оставил *конкретную форму записи актёра* на момент реализации. Кросс-проверка, породившая `ADMIN_PHASE_ACTION_PLAN.md` (v1.1), нашла, что этот пропуск теперь load-bearing и **необратим при отсрочке**:

- **C1 🔴 (6 независимых агентов):** два append-only ledger'а актёра — `audit_log` и `moderation_decisions` — **не** записывают, *какого типа принципал* действовал в момент действия. Поскольку оба append-only (триггеры неизменяемости уже это обеспечивают), строка, записанная сегодня без `principal_type`, **никогда** не может быть правдиво backfill'нута позже: мы не сможем отличить решение человека от решения агента, принятого до появления колонки. Драйвер ADR-0006 «избегать болезненных ретрофитов» применим здесь острее всего.
- **C2/C5 🔴:** `rbac-matrix.md` сейчас говорит, что agent service-auth «deferred to Фаза 2», что противоречит правилу фазирования (`IMPLEMENTATION_PLAYBOOK.md §5`): *форма* модели актёра/authz, которую любая будущая фаза иначе заставит переписать, должна быть заложена сейчас; гейтится только *поведение*.
- Нет определённой формы **human-override** решения агента, хотя ADR-0006 §71 объявляет «каждое действие агента обратимо» non-negotiable.

Этот ADR фиксирует *форму* (форму схемы, нормативное API-правило, форму цепочки authenticator'ов, жизненный цикл агента), так что активация поведения AGENT позже (по фазовой автономии ADR-0006 P-A…P-D) потребует **никакого переписывания схемы, контракта, актёра или authz**. Поведение остаётся gated; форма поставляется сейчас.

Правило фазирования применялось как decision gate повсюду: *необратимое-или-вынуждающее-переписывание → сейчас; поведение → за forward-совместимым гейтом, DEFAULT HUMAN.*

## Decision Drivers

1. **Необратимость append-only ledger'ов** — триггеры неизменяемости `audit_log`/`moderation_decisions` означают, что отсутствующий атрибут актёра — это перманентная потеря данных; это единственный сильнейший драйвер («rewrite test» возвращает *да, переписывает историю*).
2. **Non-negotiables ADR-0006** — подотчётное человеческое/юридическое лицо, обратимые действия агента, неизменяемый аудит, least-privilege scoped-учётки агента. Форма должна делать все четыре выразимыми.
3. **Правило фазирования (`§5`)** — форма сейчас, если отсрочка вынуждает будущее переписывание схемы/контракта/актёра/authz; поведение за настоящим гейтом (`DEFAULT 'HUMAN'`, по аналогии с тем, как Payment гейтится `feature_toggles.payments`).
4. **ADR-0009 (модульный монолит)** — agent service-auth — это principal/guard-concern **внутри** монолита, а не отдельный сервис; никакая граница микросервиса сейчас не вводится.
5. **Compliance (ФЗ-152, запрещённый контент)** — аудит должен позволять регулятору/оператору реконструировать, *кто или что* решило, и проследить любую человеческую отмену решения агента.
6. **Не-нарушение MVP** — MVP работает HUMAN-only; снапшот по умолчанию `HUMAN`, ни один агент не активен, ни один флоу не меняет форму.

---

## §1 — Снапшот `principal_type` актёра на append-only ledger'ах

**Considered options**

### Option 1: Join к `users.principal_type` на чтении (без колонки-снапшота)
Читать текущий `principal_type` актёра из `users` при отображении строки аудита/модерации.

Pros:
- Нет изменения схемы; один источник истины.

Cons:
- **Неверно by construction.** `users.principal_type` — изменяемое состояние аккаунта *на сейчас*; ledger должен записать состояние *на момент действия*. Аккаунт, который был HUMAN при решении и позже конвертирован в AGENT (или наоборот), переписывал бы историю на каждом чтении. Сводит на нет всю append-only-гарантию.
- Ломается, если аккаунт актёра позже стёрт (`erased_at`, ФЗ-152) или FK = `SET NULL`.

### Option 2: Снапшот `actor_principal_type` на каждую строку ledger'а на записи (Chosen)
Добавить `actor_principal_type` в `audit_log` и `moderation_decisions`, записывается на insert из действующего принципала, никогда не обновляется (append-only-триггер уже блокирует UPDATE/DELETE).

Pros:
- Правдивая, перманентная, реконструируемая регулятором запись того, кто/что действовал в момент.
- Нулевое изменение поведения в MVP (по умолчанию `HUMAN`).
- Дёшево сейчас, невозможно-правдиво-backfill'нуть-позже — ровно тот случай, где правило фазирования говорит «делать сейчас».

Cons:
- Минорная денормализация (один VARCHAR на строку); приемлемо для ledger'а аудита, где денормализованные снапшоты — корректный паттерн.

### Option 3: Отложить до Фазы 2 с раскаткой агентов
Добавить колонку только когда агенты выйдут в прод.

Cons:
- Каждая HUMAN-строка, записанная между сейчас и тогда, перманентно неатрибутируема как «это точно был человек» vs «неизвестно» — отравляет исторический след в момент, когда хотя бы один агент действует. Проваливает rewrite-test.

**Decision:** Option 2.

**ЧТО:** Добавить append-only, write-time снапшот-колонку `actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (... IN ('HUMAN','AGENT'))` в `audit_log` и `moderation_decisions`.
**ПОЧЕМУ:** Append-only ledger должен записывать состояние актёра *на момент действия*, а не joined-now; отсутствующий атрибут на неизменяемой строке невосстановим.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** Прямо удовлетворяет драйверам ADR-0006 «неизменяемый аудит» + «избегать болезненных ретрофитов» и реконструируемости по ФЗ-152; стоит одну nullable-defaulted колонку сейчас против перманентной дыры в истории позже; нет изменения поведения MVP (`DEFAULT 'HUMAN'`); соседние домены Moderation/Admin читают одно правдивое поле вместо небезопасного join. Альтернатива (join на чтении) отклонена как неверная by construction.

---

## §2 — Снапшот `actor_role` актёра

`audit_log` уже имеет `actor_role VARCHAR(20)`. `moderation_decisions` — **нет**: у него только `moderator_id`. Применяется та же логика снапшота: роль, которую держал актёр *когда решал*, должна быть заморожена, потому что `users.role` изменяема (role-elevation существует — Identity Slice 4).

**Decision:** Добавить `actor_role VARCHAR(20)` (nullable, снапшот на записи) в `moderation_decisions`, по аналогии с `audit_log`. Не ограничено CHECK по enum ролей на уровне колонки (это исторический снапшот, а enum ролей может эволюционировать между ADR; слишком жёсткий CHECK сам стал бы точкой переписывания). Записывает ту строку роли, что держал актёр.

**ЧТО:** Колонка-снапшот `moderation_decisions.actor_role VARCHAR(20)`.
**ПОЧЕМУ:** `users.role` изменяема; решение модерации должно перманентно показывать роль, под которой оно было принято.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Паритет с `audit_log` (согласованная форма снапшота актёра на обоих ledger'ах), поддерживает подотчётность/реконструкцию аудита, без CHECK-связки с всё ещё эволюционирующим enum ролей (forward-совместимо). Альтернатива (полагаться на join к `users.role`) отклонена по той же причине, что §1 Option 1.

---

## §3 — Human-override решения агента = новая append-only строка (не мутация)

Зафиксированное решение владельца (`ADMIN_PHASE_ACTION_PLAN.md` Owner-decisions #4, 2026-06-23): **human-override — это новая append-only строка, ссылающаяся на переопределённую — никогда не мутация, никогда не флаг-на-старой-строке.**

**Considered options**

### Option 1: Мутировать исходное решение (добавить флаг `overridden` / изменить `decision`)
Cons: нарушает append-only-триггер; уничтожает исходное решение агента; неаудитируемо. Отклонено сразу (противоречит non-negotiable ADR-0006 «неизменяемый аудит»).

### Option 2: Новая append-only строка + `supersedes_decision_id` + `is_human_override` (Chosen, locked)
Человек вставляет свежую строку `moderation_decisions` со своим `moderator_id` (HUMAN-принципал), `actor_principal_type='HUMAN'`, `is_human_override=TRUE` и `supersedes_decision_id` → строка агента. Обе строки остаются навсегда. Цепочка агент→человек полностью реконструируема.

Pros:
- Сохраняет полную цепочку решений; и акт агента, и акт человека — неизменяемая запись.
- Удовлетворяет «обратимо + неизменяемый аудит» вместе.
- Override сам — first-class, аудируемое действие принципала (несёт собственный снапшот актёра).

Cons:
- Read-сторона должна резолвить «последнее эффективное решение» через `supersedes_decision_id` (самоссылочный lookup); приемлемо и является стандартным event-sourcing-style чтением.

**Decision:** Option 2.

**ЧТО:** Добавить в `moderation_decisions`: `supersedes_decision_id UUID NULL REFERENCES moderation_decisions(id) ON DELETE RESTRICT` и `is_human_override BOOLEAN NOT NULL DEFAULT FALSE`.
**ПОЧЕМУ:** Человек, отменяющий агента, не должен стирать запись агента; отмена — это новый подотчётный акт, связанный с исходным.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Делает «каждое действие агента обратимо И записано в неизменяемый аудит» из ADR-0006 одновременно истинным; даёт регуляторам/операторам полную цепочку агент→человек; переиспользует существующий append-only-триггер вместо его ослабления; связь `supersedes` — минимальная forward-совместимая форма для раскатки автономии P-A…P-D. Owner-locked — здесь не переоткрывается.

**Нормативные правила override:**
- У строки-override `actor_principal_type` ДОЛЖЕН быть `HUMAN`, а `is_human_override` ДОЛЖЕН быть `TRUE` (применяется в сервис-слое; см. Migration spec для тестируемого partial-инварианта).
- `supersedes_decision_id` ДОЛЖЕН указывать на существующее решение на **той же** `(entity_type, entity_id)`.
- Строка с `is_human_override=TRUE` ДОЛЖНА иметь non-NULL `supersedes_decision_id` (и наоборот: non-NULL `supersedes_decision_id` маркирует override). Это биусловие — негативно-тестовый инвариант.

---

## §4 — Жизненный цикл агента = деактивация, не удаление

**Decision:** Принципал-агент — это аккаунт (строка `users` с `principal_type='AGENT'`). Он выводится из эксплуатации **деактивацией** (`status='DEACTIVATED'` / `is_active=FALSE` / `deactivated_at`), никогда удалением строки.

**ЧТО:** Нормативное правило: аккаунты агентов следуют существующей стейт-машине жизненного цикла пользователя; вывод = DEACTIVATED, никогда DELETE.
**ПОЧЕМУ:** Решения агента ссылаются из `moderation_decisions.moderator_id` (FK `ON DELETE RESTRICT`) и `audit_log.actor_id`; удаление аккаунта осиротило бы или `SET NULL`-нуло бы неизменяемый след и уничтожило бы подотчётность.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Сохраняет целостность аудита и цепочку подотчётного-лица (non-negotiable ADR-0006) с **нулевой новой схемой** — переиспользует существующую стейт-машину пользователя и семантику FK. Forward-совместимо: будущая per-agent таблица метаданных `agents` (ADR-0006 §93, отложена в P-A) может прицепиться к тому же UUID без изменения этого правила.

---

## §5 — ФОРМА agent service-auth (источник-агностичный principal через цепочку authenticator'ов) — внутри монолита

Зафиксированный канон: agent-service-auth — это principal/guard-concern внутри монолита (ADR-0009). Форма сейчас; поведение gated.

**Considered options**

### Option 1: Второй, параллельный guard для агентов
Cons: дублирует authz-логику; два code-path дрейфуют; матрицу пришлось бы применять дважды. Отклонено.

### Option 2: Источник-агностичный principal, резолвимый цепочкой authenticator'ов за одним guard'ом (Chosen)
Guard резолвит **единую абстракцию принципала** (`{ actor_id, principal_type, role, ... }`) независимо от *того, как* запрос аутентифицировался. Аутентификация выносится из `JwtAuthGuard` в упорядоченную цепочку `RequestAuthenticator`'ов:
- `BearerJwtAuthenticator` — **есть сейчас** (человеческие конечные пользователи + операторы через phone-OTP/OAuth JWT).
- `AgentServiceTokenAuthenticator` — **добавляется аддитивно потом** (scoped service-токен для AGENT-принципала); встаёт в ту же цепочку, возвращает ту же форму принципала, поведение за гейтом AGENT.

Всё downstream (RBAC-матрица, CASL-abilities, объектное владение, снапшот актёра в §1–§3) потребляет абстракцию принципала и **уже источник-агностично** (кросс-проверка C4 подтвердила, что субъект authz сегодня agent-агностичен). Так что добавление агентов позже — **один дополнительный authenticator**, а не переписывание guard/authz.

Pros:
- Нет будущего переписывания guard'ов, RBAC или записи актёра; агенты подключаются аддитивно.
- Один authz-путь, одна матрица, defense-in-depth без изменений.
- Соблюдает ADR-0009: всё внутри монолита, без границы сервиса.

Cons:
- Небольшой upfront-рефакторинг для выделения цепочки authenticator'ов (работа над формой, A0b).

**Decision:** Option 2.

**Форма, которую закладываем сейчас (этот ADR — архитектурное решение; backend реализует в A0b):**
1. **Форма цепочки authenticator'ов** — выделить аутентификацию из `JwtAuthGuard` в упорядоченную цепочку `RequestAuthenticator`, производящую источник-агностичный principal `{ actor_id, principal_type, role }`. `BearerJwt` сейчас; `AgentServiceToken` — аддитивное будущее звено. Без изменения поведения для HUMAN.
2. **Форма env signing-секрета** — env-переменная signing-секрета service-credential, **минимальная длина ≥ 32** (валидируется на boot, та же дисциплина, что у существующих секретов); объявлена в `.env.example`. Присутствует как форма; ни один токен агента не выдаётся, пока гейт AGENT не включён.
3. **Форма хранения / ротации / revoke service-credential** — service-credential для AGENT-принципала хранятся, ротируемы и отзываемы **внутри монолита** (напр. колонка/таблица hashed-secret, привязанная к `users.id` агента, с ротацией = issue-new + revoke-old, revoke = mark inactive). Этот ADR фиксирует, что форма живёт in-monolith и ротируема/отзываема; точная таблица/колонки специфицируются в Migration spec как *forward-совместимый stub*, gated, не заполняется в MVP. (Детальная схема credential-store может быть финализирована с backend в P-A; этот ADR запрещает отдельный auth-сервис и запрещает неротируемый/неотзываемый дизайн.)

**ЧТО:** Источник-агностичный principal через цепочку authenticator'ов внутри монолита; форма env signing-секрета (≥32); форма ротируемого/отзываемого in-monolith service-credential. Поведение gated.
**ПОЧЕМУ:** Субъект authz уже agent-агностичен; единственный реальный пропуск — *как принципал аутентифицируется* и *где живут учётки агента* — закладка этого как формы сейчас избегает переписывания guard/authz/секрета, когда P-A активируется.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Максимально дешёвая forward-совместимость (один authenticator добавлен, а не подсистема переписана); сохраняет единый authz-путь и одну авторитетную RBAC-матрицу; соблюдает ADR-0009 (без преждевременного раскола на сервисы); ротация/revoke, запечённые в форму, удовлетворяют least-privilege + non-negotiable ADR-0006 «scoped credentials». Альтернатива (параллельный guard агента) отклонена как drift-prone дублирование.

---

## §6 — Нормативное правило: каждый actor-bearing ответ/событие несёт `{actor_id, principal_type}`

**Decision (нормативно, platform-wide):** Любой API-ответ или доменное событие, называющее актёра (решения модерации, записи аудита, админ-действия и любой будущий actor-stamped payload), ДОЛЖНЫ нести актёра как `{ actor_id, principal_type }` (форма «agent-badge»), а не голый `actor_id`. Это контрактное зеркало снапшота схемы из §1.

Это правило **владеется здесь** и **применяется** владельцами контрактов: `API_CONVENTIONS.md` записывает его как конвенцию (план B0.6), а затронутые `*.yaml`-контракты (moderation, audit, admin) принимают форму. Этот ADR не редактирует контракты (другие агенты владеют этими файлами); он устанавливает обязывающее правило, которое они должны реализовать.

**ЧТО:** Нормативное API/event-правило — актёр всегда `{actor_id, principal_type}`.
**ПОЧЕМУ:** Потребитель (операторский UI, downstream-сервис, экспорт для регулятора) должен суметь отличить решение человека от решения агента без второго lookup; форма ответа должна совпадать с правдивым снапшотом схемы.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Закрывает петлю схема↔контракт (снапшот бесполезен, если API его прячет); forward-совместимо (поле `principal_type` = `HUMAN` для всех MVP-ответов, так что принятие сейчас стоит нуля и избегает breaking-изменения контракта, когда агенты появятся); поддерживает отложенный продуктовый вопрос, видит ли конечный пользователь «решено ИИ» (Owner-decision #5, открыт) — данные присутствуют независимо от выбора отображения.

---

## §7 — Канон ролей (A1): 7 ролей, additive-модель, `principal_type ⟂ role`, SUPER_ADMIN вне `users.role`

Это консолидирует канон ролей здесь, чтобы он не дублировался по докам (план A1 просит architect заякорить его в ADR-0011).

**Зафиксированный канон (не переоткрывается):**
- **`users.role` = ровно 7 ролей:** `USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER` (совпадает с `database_schema.sql` строка 109 CHECK).
- **Additive-модель:** `BREEDER/FARMER/VETERINARIAN/GROOMER = USER + доп. возможности` (наследуют все права USER). `MODERATOR`/`ADMIN` — операторские роли. CASL композирует наборы abilities аддитивно (по implementation notes rbac-matrix).
- **SUPER_ADMIN НЕ является значением `users.role`.** Любая super-admin / break-glass-возможность моделируется вне enum `users.role` (напр. отдельный механизм operator-elevation). Добавление `SUPER_ADMIN` в enum отклонено — это смешало бы контроль privilege-escalation с таксономией ролей.
- **`principal_type ⟂ role` (инвариант ортогональности).** `principal_type` (HUMAN|AGENT) независим от `role`. Любую из 7 ролей в принципе может держать любой тип принципала; операторские роли (MODERATOR, позже ADMIN) — те, на которые нацелен ADR-0006 для AGENT. Матрица применяется идентично независимо от `principal_type`. Этот инвариант якорится **здесь** и НЕ ДОЛЖЕН дублироваться как schema CHECK'и, связывающие две колонки (такая связка сама стала бы точкой переписывания).
- **Org-scoped роли — отдельная ось:** `organization_users.role_in_org = {OWNER, ADMIN, STAFF, VET}` — **не** тот же enum, что `users.role`, и **MODERATOR НЕ является валидным `role_in_org`** (модерация — платформенно-операторская роль, не роль org-членства).

**Гигиена дубль-определения `role_in_org` (пропуск схемы → backend migration-spec):**
`database_schema.sql` определяет `role_in_org` несогласованно:
- Строка **79** (inline CREATE TABLE CHECK): включает `'MODERATOR'` — `CHECK (role_in_org IN ('OWNER','ADMIN','STAFF','VET','MODERATOR'))`.
- Строка **986** (ALTER, named `chk_org_user_role`): **исключает MODERATOR** — `CHECK (role_in_org IN ('OWNER','ADMIN','STAFF','VET'))`.
- Комментарий строка **722**: всё ещё говорит «OWNER, ADMIN, STAFF, VET, MODERATOR».

Named-ограничение на :986 — *эффективное* runtime-состояние (выполняется после inline) и корректный канон (без MODERATOR). Inline CHECK и комментарий устарели и противоречивы. Канонический набор из 4 значений должен стать единственным источником истины, устаревший текст удалён. Это backend migration-spec item (см. Migration spec §D).

**ЧТО:** Заякорить канон 7 ролей, additive-модель, SUPER_ADMIN-вне-enum, `principal_type ⟂ role` и канон `role_in_org` из 4 значений; пометить противоречие schema:79/:722 vs :986 для backend-ремедиации.
**ПОЧЕМУ:** Канон ролей дрейфовал между identity-BR/admin-BR/org-BR, а схема имеет живое самопротиворечие в `role_in_org`; единый нормативный якорь предотвращает re-litigation и shipping неверного CHECK.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Один источник истины (этот ADR + schema CHECK) вместо N дрейфующих копий; держит `principal_type` ортогональным (без хрупкого cross-column CHECK, который будущая раскатка агентов вынуждена была бы разматывать); чинит реальный correctness-баг (два противоречивых CHECK + вводящий в заблуждение комментарий) до того, как Admin Slice 2-4 построит на нём authz. Канон `role_in_org` из 4 значений — безопасный (operator-модерация не должна быть grantable как org-членство).

---

## Migration spec (для `zoolink-backend-engineer` — этот ADR НЕ пишет миграцию и не редактирует `database_schema.sql`)

Следовать DB-workflow из `IMPLEMENTATION_PLAYBOOK.md §3`: правка `database_schema.sql` + новая идемпотентная миграция `migrations/YYYYMMDD_NNNN_*.sql` + `ZooLink_ERD.mmd` + `docs/03-architecture/data-model.md` + счётчики таблиц/миграций в обоих `CLAUDE.md`; прогон дважды на живом PG; добавить негативные тесты; затем `npm run db:sync`. EN↔RU неприменимо к SQL, но проза data-model.md должна зеркалить.

### §A — `audit_log`
- `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (actor_principal_type IN ('HUMAN','AGENT'));`
- Идемпотентно (`ADD COLUMN IF NOT EXISTS`; CHECK едет вместе с добавлением колонки — при повторном прогоне на существующей колонке это no-op).
- Backfill не нужен: существующие строки корректно по умолчанию `HUMAN` (истина MVP).
- `actor_role` уже существует — без изменения.

### §B — `moderation_decisions`
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (actor_principal_type IN ('HUMAN','AGENT'));`
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS actor_role VARCHAR(20);` (nullable снапшот; без enum CHECK — см. §2).
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS supersedes_decision_id UUID REFERENCES moderation_decisions(id) ON DELETE RESTRICT;`
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS is_human_override BOOLEAN NOT NULL DEFAULT FALSE;`
- **Биусловный инвариант (§3)** — обеспечить, что `is_human_override` и `supersedes_decision_id` non-NULL вместе, через table CHECK:
  `ADD CONSTRAINT chk_moddec_override CHECK ( (is_human_override = TRUE AND supersedes_decision_id IS NOT NULL) OR (is_human_override = FALSE AND supersedes_decision_id IS NULL) )` — добавлять с `DROP CONSTRAINT IF EXISTS chk_moddec_override` сначала для идемпотентности.
- Опциональный индекс для чтения override-цепочки: `CREATE INDEX IF NOT EXISTS idx_moddec_supersedes ON moderation_decisions(supersedes_decision_id) WHERE supersedes_decision_id IS NOT NULL;`
- Существующий append-only-триггер неизменяемости без изменений и теперь также защищает новые колонки.
- **Правило сервис-слоя** (не DB CHECK, поскольку охватывает строки): у строки-override `actor_principal_type` ДОЛЖЕН быть `HUMAN`, а её `supersedes_decision_id` ДОЛЖЕН ссылаться на решение с той же `(entity_type, entity_id)`.

### §C — Форма service-credential агента (§5.3) — forward-совместимый stub, gated, НЕ заполняется в MVP
Backend + architect финализируют точную форму на A0b/P-A. Минимальная forward-совместимая форма:
- Hashed-secret store, привязанный к `users.id` агента, поддерживающий **ротацию** (issue-new + revoke-old) и **revoke** (mark inactive). Либо таблица `service_credentials` (`id`, `agent_user_id FK users(id) ON DELETE RESTRICT`, `secret_hash`, `is_active`, `created_at`, `revoked_at`), либо эквивалентная in-monolith форма. Без plaintext-секретов at rest.
- **Не** создавать это как часть A0a, если есть риск scope-creep; жёсткое требование A0a — §A + §B. Credential-store — это A0b. Этот ADR только запрещает: (a) отдельный auth-сервис, (b) неротируемый/неотзываемый дизайн, (c) plaintext-хранение секрета.
- Env: `AGENT_SERVICE_SIGNING_SECRET` (или эквивалент) с валидацией длины ≥32 на boot; добавить в `.env.example`. Только форма; не используется, пока гейт AGENT выключен.

### §D — Гигиена канона `role_in_org` (§7)
- Сделать набор из **4 значений** каноническим и убрать противоречие:
  - Обновить inline CREATE TABLE CHECK на строке ~79, убрав `'MODERATOR'` (чтобы файл-источник-истины совпадал с эффективным named-ограничением).
  - Сохранить/подтвердить named `chk_org_user_role` на ~986 как набор из 4 значений (уже корректно).
  - Исправить устаревший COMMENT на строке ~722 на `'OWNER, ADMIN, STAFF, VET'`.
- Идемпотентно: `DROP CONSTRAINT IF EXISTS chk_org_user_role; ADD CONSTRAINT chk_org_user_role CHECK (role_in_org IN ('OWNER','ADMIN','STAFF','VET'));` (уже форма миграции) — inline-правка — это фикс согласованности файла-источника, не runtime-изменение.

### §E — Негативные тесты (DoD)
1. **append-only:** `UPDATE`/`DELETE` на `audit_log` и `moderation_decisions` (включая новые колонки) отвергается триггером неизменяемости.
2. **снапшот принципала:** AGENT-принципал может записать строку `moderation_decisions` с `actor_principal_type='AGENT'` (проходит guard при включённом гейте — тестируем, что схема это принимает); строка по умолчанию `HUMAN`, когда не указано.
3. **инвариант override:** вставка `is_human_override=TRUE` с NULL `supersedes_decision_id` отвергается `chk_moddec_override`; и `is_human_override=FALSE` с non-NULL `supersedes_decision_id` отвергается.
4. **актёр override — человек:** тест сервис-слоя, что строка-override отвергается, если `actor_principal_type != 'HUMAN'`.
5. **канон ролей:** `users.role='SUPER_ADMIN'` отвергается (CHECK); `organization_users.role_in_org='MODERATOR'` отвергается `chk_org_user_role`.
6. **идемпотентность:** прогон миграции дважды на живом PG — второй прогон — чистый no-op (всё под `IF NOT EXISTS` / `DROP…IF EXISTS`).

### ERD / data-model
- `ZooLink_ERD.mmd`: добавить новые колонки `moderation_decisions` (вкл. самоссылочный `supersedes_decision_id` → `moderation_decisions`) и `audit_log.actor_principal_type`.
- `docs/03-architecture/data-model.md`: задокументировать паттерн снапшота актёра, override-цепочку и stub service-credential агента (gated).
- Счёт таблиц: +0, если credential-store отложен в A0b (в A0a добавлены только колонки); +1, если `service_credentials` создан в A0b. Обновить счётчики, когда таблица реально появится.

---

## Consequences

### Positive
- Append-only ledger'ы становятся правдивыми о human-vs-agent на все времена; драйверы ADR-0006 неизменяемый-аудит/избегать-ретрофита удовлетворены в наипозднейший дешёвый момент.
- Human-override — first-class, полностью аудируемый, обратимый акт (owner-locked форма).
- Активация агентов позже (P-A…P-D) аддитивна: один authenticator + флип гейта, без переписывания схемы/контракта/authz.
- Канон ролей имеет единый нормативный якорь; живое противоречие схемы (`role_in_org`) запланировано к фиксу до того, как на нём построен Admin-authz.

### Negative
- Минорная денормализация (колонки-снапшоты) и небольшой рефакторинг цепочки authenticator'ов (A0b).
- Read-сторона должна резолвить override-цепочку через `supersedes_decision_id`.

### Neutral
- Поведение MVP без изменений: всё по умолчанию `HUMAN`; ни один агент не активен; ни один токен агента не выдан.
- Детальная схема `service_credentials` намеренно финализируется с backend в A0b/P-A; этот ADR фиксирует лишь её non-negotiable-свойства (in-monolith, ротируема, отзываема, hashed).

## Related Decisions
- [ADR-0006](0006-ai-agents-operate-platform.md) — amended (конкретная форма актёра для directional-решения).
- [ADR-0009](0009-mvp-vs-target-architecture.md) — agent service-auth остаётся внутри монолита.
- [ADR-0003](0003-pre-moderation-workflow.md) — модерация — первая цель агента; этот ADR формирует её ledger решений.
- [ADR-0001](0001-tech-stack.md) — NestJS guards/цепочка authenticator'ов, CASL-abilities.

## References
- `ADMIN_PHASE_ACTION_PLAN.md` v1.1 — фазы A0a/A0b/A1, Owner-decisions #4 (форма human-override locked 2026-06-23), находки кросс-проверки C1/C2/C4/C5.
- `IMPLEMENTATION_PLAYBOOK.md` §3 (DB-workflow), §5 (граница фаз / rewrite test).
- `database_schema.sql` — `users` (строка 109 enum ролей, 112 principal_type), `moderation_decisions` (~374, append-only-триггер ~396), `audit_log` (~1081, append-only-триггер ~1099), `organization_users.role_in_org` (79 / 722 / 986).
- `docs/specs/security/rbac-matrix.md` — форма agent-principal/service-auth (этот ADR переписывает там нарратив §Roles).
