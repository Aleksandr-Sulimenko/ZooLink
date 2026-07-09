# ADR-0037: Scoped-ability для принципалов AGENT — deny-by-default, без `manage:all`, эффективные = матрица-роли ∩ scope

**Статус**: Proposed
**Дата**: 2026-07-08
**Уточняет / развивает**: [ADR-0011](0011-agent-principal-actor-model.md) §7 (`principal_type ⟂ role`) — уточняет инвариант ортогональности для *слоя авторизации*: матрица role→ability — это **потолок**; **эффективные** abilities агента = этот потолок, **пересечённый с явным least-privilege scope**. **Не** переписывает/supersede-ит ADR-0011 и **не** вводит cross-column schema CHECK, связывающий role и principal_type (что ADR-0011 §7 запрещает).
**Связано**: [ADR-0006](0006-ai-agents-operate-platform.md) (непреложное #4 = scoped, least-privilege права; #3 = human override), [ADR-0036](0036-agent-credential-issuance.md) (credential/JWT, несущий scope), [ADR-0022](0022-multi-role-user.md) (прецедент dormant-form-first, миграция 0034), RBAC-матрица `docs/specs/security/rbac-matrix.md`.
**Триггер аудита**: AUDIT4 **P1-6** *«[NS] AGENT ограничен только человеческой ролью — AGENT+ADMIN наследует `manage:all`; нет scoped-ability-шва → любая операторская власть агента небезопасна»* (⇊converged security + architect); `AUDIT4/security.md` §STRATEGIC FC-2 (`ability.factory.ts:46-84`); `AUDIT4/architect.md` §4a scorecard (scoped-ability BLOCKED).

---

## Контекст и постановка проблемы

`AbilityFactory.createForPrincipal` (`backend/src/lib/auth/ability.factory.ts:51`) ограничивает принципала **исключительно его человеческой `role`**:

```ts
case 'ADMIN':
  can('manage', 'all'); // полный операторский scope
```

Поскольку ADR-0011 §7 делает `principal_type ⟂ role` (AGENT может держать любую роль), агент-аккаунт с `role='ADMIN'` наследует **платформенный `manage:all`** — любое действие над любым субъектом — **без агент-специфичного предела**: нет least-privilege scope, нет ограничения радиуса поражения, нет per-capability-лимита. AUDIT4 проверил это по коду и оценил как P1-6 / `[NS]` BLOCKED: *«не предоставлять никакой операторской власти AGENT на текущей модели»* — автономный оператор-агент на этой модели либо бессилен (нет creds — исправляется [ADR-0036](0036-agent-credential-issuance.md)), либо **сверх-полномочен** (наследует всю власть человеческой роли).

Это неэксплуатируемо *сегодня* (ни один AGENT не активен; master-гейт [ADR-0036](0036-agent-credential-issuance.md) off). Это **forward-compat / cost-of-change**-дефект: в момент активации agent-auth до появления этого шва оператор-агент получает admin-широкую власть. AUDIT4 §4c #4 говорит исправить *форму* сейчас — дешевле всего до того, как Admin Slice 2 захардкодит human-only-допущение, и это ровно то обобщение, о котором просит AUDIT4/architect #2 («поднять safety-паттерн moderation до cross-cutting agent-operable-action-контракта»).

Непреложное ADR-0006 #4 («агенты имеют scoped, least-privilege права») и ADR-0011 §5/§C («least-privilege scoped agent credentials») уже **требуют** это; разрыв в том, что требование никогда не было локализовано в слое abilities. Этот ADR его закрывает: **deny-by-default, явно-scoped** модель abilities для принципалов AGENT, которая никогда не выдаёт wildcard `manage:all`, сохраняет human override и совместима с существующей RBAC-матрицей и `x-required-roles`.

**Согласование с ADR-0011 §7.** ADR-0011 §7 говорит «матрица применяется одинаково независимо от `principal_type`» и запрещает связывать две колонки в схеме. Эта ортогональность — про **семантику ролей**: AGENT-MODERATOR и HUMAN-MODERATOR управляются *одной и той же* матрицей role→ability; она **не** означает, что AGENT получает власть роли безусловно. Этот ADR сохраняет семантику ролей идентичной (матрица неизменна и является потолком для обоих) и добавляет, исключительно в **слое авторизации** (не в схеме), что *эффективный* грант AGENT = `matrix(role) ∩ scope`, deny-by-default. Cross-column CHECK не вводится. Следовательно: **уточнение/дополнение** §7 для authz-слоя, а не противоречие.

## Драйверы решения

1. **Least-privilege / радиус поражения (ADR-0006 #4, ADR-0011 §5/§C)** — автономный оператор-агент должен иметь минимальные полномочия для своей задачи и ограниченный, убиваемый радиус поражения. Высший драйвер.
2. **Никакого тихого over-grant (AUDIT4 P1-6)** — `manage:all` должен быть **недостижим** для AGENT, по построению, даже при `role='ADMIN'`.
3. **Human override сохранён (ADR-0006 #3, ADR-0011 §3)** — человек всегда может переопределить решение агента и всегда авторизационно выше агента; scope никогда не блокирует человеческий контроль.
4. **Один authz-путь (ADR-0011 §5)** — без параллельной agent-ability-фабрики; пересечение живёт в единой `AbilityFactory`, потребляемой единым `PoliciesGuard`.
5. **Совместимость с RBAC-матрицей + `x-required-roles`** — грубый role-гейт (`RolesGuard`) остаётся; scope — *дополнительное* тонкое сужение, никогда не расширение.
6. **Dormant-form-first (прецедент ADR-0022 / миграция 0034, `IMPLEMENTATION_PLAYBOOK.md §5`)** — HUMAN-поведение побайтово-идентично; ветка AGENT спит, пока агент не провижионен; отгружаем шов, а не живое поведение.
7. **Обобщить проверенный паттерн (AUDIT4/architect #2)** — moderation = READY-эталон (`agent_moderation`-toggle + снапшот + override); модель scope должна чисто на него лечь и расшириться на admin/report далее.

---

## §1 — Шов scope: deny-by-default-ветка AGENT, эффективные = matrix(role) ∩ scope

**Рассмотренные варианты**

### Вариант 1: Оставить матрицу идентичной; полагаться только на per-domain-toggle `agent_<domain>`
Оставить `AbilityFactory` как есть; ограничивать агентов исключительно существующими per-capability autonomy-toggle (`agent_moderation` у moderation).

Плюсы:
- Ноль изменений кода слоя abilities.

Минусы:
- Toggle **бинарен per capability** и ортогонален *authorization scope*: AGENT-ADMIN с `manage:all` и включённым admin-autonomy-toggle мог бы делать **что угодно** admin — нет least-privilege, нет ограничения радиуса поражения. Прямо проваливает ADR-0006 #4 и AUDIT4 P1-6. Отклонён.

### Вариант 2: Отдельная параллельная agent-ability-фабрика
Вторая фабрика вычисляет ability агента независимо.

Минусы:
- Два authz-пути дрейфуют (ровно причина, по которой ADR-0011 §5 отклонил параллельный agent-guard); RBAC-матрица применялась бы дважды и разошлась. Отклонён.

### Вариант 3: AGENT-специфичные роли в enum (например `AGENT_MODERATOR`)
Добавить агент-варианты в `users.role`.

Минусы:
- Нарушает ортогональность ADR-0011 §7 (`principal_type ⟂ role`) и форкает зафиксированный 7-ролевой канон; scope — это *грант возможностей*, а не роль. Отклонён.

### Вариант 4: deny-by-default-ветка AGENT в единой `AbilityFactory`; эффективные = matrix(role) ∩ scope (Выбран)
`AbilityFactory.createForPrincipal` получает одну явную ветку: **если `principalType === 'AGENT'`**, начать с **deny-all**, затем выдать **только** abilities, названные в `scope` принципала, каждый **дополнительно пересечённый с тем, что позволила бы `matrix(role)`** (роль остаётся потолком — агент никогда не превысит свою роль и никогда не достигнет `manage:all`, потому что ветка AGENT никогда не эмитит wildcard). AGENT с пустым/отсутствующим scope получает **ничего** (deny-by-default). HUMAN-путь не тронут (побайтово-идентичен). Данные scope несёт принципал как JWT-claim, заполняемый обменом [ADR-0036](0036-agent-credential-issuance.md) из credential — поэтому `AbilityFactory` читает его **без лишнего обращения к БД**.

Плюсы:
- `manage:all` **структурно недостижим** для AGENT (wildcard живёт только в HUMAN-`ADMIN`-ветке).
- Один authz-путь, одна матрица (драйвер 4); RBAC-матрица остаётся единственным потолком.
- deny-by-default — правильный дефолт безопасности (fail-safe): плохо провижионенный агент получает ничего, никогда всё.
- Scope едет в JWT (из credential) → нет per-request-поиска scope; отзыв/ротация credential (ADR-0036 §4) мгновенно меняет будущий scope.
- Ложится прямо на moderation (§3) и обобщается на admin/report (запрос AUDIT4 #2).

Минусы:
- Ещё одна концепция (scope) для определения и валидации; требует словаря scope. Приемлемо — это least-privilege-примитив, уже предписанный ADR-0006.

**Решение:** **Вариант 4.** Для принципала AGENT: **deny-by-default**, эффективная ability = **`matrix(role) ∩ scope`**, и wildcard `manage:all` **никогда** не эмитится для AGENT. HUMAN-поведение без изменений.

**ЧТО:** Добавить deny-by-default-ветку AGENT в единую `AbilityFactory`: эффективные abilities AGENT = потолок матрицы роли, пересечённый с явным scope; пустой scope = никаких abilities; `manage:all` недостижим для AGENT.
**ПОЧЕМУ:** AGENT не должен наследовать бланкетную власть человеческой роли; least-privilege + убиваемый радиус поражения требуют явного, пересечённого, deny-by-default-гранта, а не наследования только по роли.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** Прямо закрывает AUDIT4 P1-6 и удовлетворяет ADR-0006 #4 при **одном** authz-пути (без дрейфа, ADR-0011 §5); deny-by-default fail-safe (мисконфиг даёт бессилие, никогда всемогущество); роль остаётся потолком, поэтому ортогональность ADR-0011 §7 сохранена (семантика ролей идентична для обоих типов принципалов) **без** cross-column schema CHECK; scope-в-JWT держит это вне горячего пути. Отклонены: toggle-only (нет гранулярности scope — дефект P1-6); параллельная фабрика (дрейф, ADR-0011 §5); агент-роли-в-enum (форкает 7-ролевой канон, ломает ортогональность §7).

---

## §2 — Где живёт scope: на credential (спящий), встроен в JWT при обмене

**Рассмотренные варианты**

### Вариант A: Per-credential-колонка scope (`service_credentials.scope JSONB`) (Выбран пока)
Каждый credential несёт свой scope; обмен [ADR-0036](0036-agent-credential-issuance.md) читает его и встраивает в выданный JWT AGENT как claim; `AbilityFactory` читает claim.

Плюсы:
- Scope **сорасположен с credential** (ADR-0036) — выдача, ротация, отзыв и scoping — один администрируемый объект, меняемый/убиваемый в одном месте одним человеческим актом.
- Нет лишней таблицы сейчас; аддитивная nullable-колонка (N-1 safe); deny-by-default = NULL scope.

Минусы:
- Если много агентов делят scope, он дублируется per credential (приемлемо при размере флота эпохи MVP; поднять до Варианта B, если вырастет).

### Вариант B: Таблица именованных capability-профилей (`agent_capability_profiles` + назначение)
Профиль = именованный, переиспользуемый набор abilities (например `moderation-agent`); агент ссылается на профиль.

Плюсы:
- DRY для большого флота агентов; человекочитаемо («этот агент — moderation-agent»).

Минусы:
- Новая таблица(ы) + плюмбинг назначения до того, как есть флот, это оправдывающий — преждевременно. Зарезервировать как позднейшую эволюцию *за* швом credential-scope (профиль — сахар, разрешающийся в тот же JWT scope-claim).

**Решение:** **Вариант A сейчас** (scope на строке credential, встраивается в JWT при обмене), **Вариант B зарезервирован** как позднейшая эволюция масштаба — оба разрешаются в один и тот же JWT-`scope`-claim, потребляемый `AbilityFactory`, поэтому продвижение A→B позже аддитивно и не трогает слой abilities. Это предлагаемая колонка `service_credentials.scope`, которую [ADR-0036](0036-agent-credential-issuance.md) §7 умышленно оставил этому ADR.

**Словарь scope (нормативный):** scope — список грантов `{ action, subject }` из **того же** словаря `Action × Subject`, что уже определяет RBAC-матрица / `AbilityFactory` (`Action ∈ {read, create, update, delete}` — **никогда `manage`**; `Subject ∈` существующий enum субъектов — **никогда `all`**). Запрет `manage`/`all` в scope — это то, что делает wildcard-власть структурно невозможной для AGENT. Валидатор scope (слой сервиса) отклоняет любой грант, содержащий `manage` или `all`.

**ЧТО:** Scope живёт на `service_credentials.scope JSONB` (nullable, deny-by-default), встраивается в JWT AGENT при обмене; словарь scope = существующий набор `{action, subject}` минус `manage`/`all`; таблица именованных профилей зарезервирована на потом.
**ПОЧЕМУ:** Scope должен администрироваться вместе с credential и быть доступен во время запроса без обращения к БД, делая при этом wildcard-власть невыразимой.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Сорасположение scope с credential (ADR-0036) делает грант/ротацию/отзыв одним атомарным человеко-администрируемым объектом; переиспользование существующего словаря `{action,subject}` означает отсутствие нового authz-языка; исключение `manage`/`all` из словаря обеспечивает P1-6 по построению; зарезервированная таблица профилей позволяет масштабу прийти позже без изменения слоя abilities (аддитивно, в стиле dormant-form-first ADR-0022).

---

## §3 — Эталонное отображение: moderation-agent (READY-случай)

Moderation — **READY**-эталон AUDIT4 (agent-toggle + actor-снапшот + human-override все построены, миграции 0011/0016). Его scope ложится чисто и демонстрирует два независимых предела:

- **scope `moderation-agent`** = `[{read, ModerationQueue}, {create, ModerationDecision}, {read, Listing}, {read, ContentReport}]`.
- AGENT с `role='MODERATOR'` **и этим scope** может модерировать — и **ничего больше**. Заметьте, матрица даёт HUMAN-MODERATOR *больше* (`update User` для suspend, `update Listing`, `read AuditLog`); scope **сужает агента ниже потолка его роли** — ровно least-privilege. Он также никогда не касается `manage:all` (это только HUMAN-ADMIN-ветка).
- **Оба независимых предела должны пройти**, чтобы агент реально решил: (1) per-domain **autonomy-toggle** `agent_moderation` (`moderation.service.ts:289` — *включена ли автономная модерация вообще?*) **и** (2) **scope** (*держит ли этот конкретный агент ability `create ModerationDecision`?*). Плюс upstream master-auth-гейт [ADR-0036](0036-agent-credential-issuance.md). Три гейта: master-auth → scope → per-domain autonomy.
- **Human override без изменений:** ADR-0011 §3 (новая append-only-строка, `actor_principal_type='HUMAN'`, `supersedes_decision_id`) не тронут; человек всегда авторизационно выше и может отменить любое решение агента.

Это конкретный экземпляр «cross-cutting agent-operable-action-контракта» AUDIT4/architect #2: **каждая операторская запись агента = actor-снапшот (ADR-0011 §1) + scoped ability (этот ADR) + per-domain autonomy-toggle + путь human override/supersede.** Admin и content-report (оба SEAM-NEEDED в scorecard) принимают идентичную форму, когда приходят их slice.

**ЧТО:** Определить scope `moderation-agent`; AGENT-MODERATOR с ним может только модерировать (уже своей роли); реальное действие требует master-гейт ∩ scope ∩ `agent_moderation`-toggle; human override не тронут.
**ПОЧЕМУ:** READY-домен должен продемонстрировать шов сквозь весь путь и задать шаблон, переиспользуемый admin/report.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Превращает moderation-only safety-паттерн в переиспользуемый четырёхчастный контракт (снапшот + scope + autonomy-toggle + override) ровно как просил AUDIT4/architect #2; стек трёх гейтов даёт градуированную, независимо-убиваемую автономию, соответствующую P-A…P-D ADR-0006; least-privilege *продемонстрирован* (scope < role), а не только заявлен.

---

## §4 — Совместимость с `x-required-roles` / RBAC-матрицей

Соглашение `x-required-roles` (`API_CONVENTIONS.md`, обеспечивается `RolesGuard` по `rbac-matrix.md`) — **грубый role-гейт**, работающий **до** тонкой CASL-проверки (`PoliciesGuard` → `AbilityFactory`). Этот ADR **не** меняет **ни** матрицу, **ни** `x-required-roles`:

- Role-гейт всё равно применяется к AGENT (AGENT-MODERATOR проходит роут `x-required-roles: MODERATOR` — role ⟂ principal_type, ADR-0011 §7).
- CASL-слой **дополнительно** пересекает scope. Поэтому для AGENT `x-required-roles` **необходим, но недостаточен**: он должен держать роль **и** scoped ability. Scope может только **сужать**, никогда расширять — агент никогда не сделает того, что запрещает его role-гейт.
- Для HUMAN оба слоя ведут себя ровно как сегодня (scope отсутствует ⇒ полная матрица роли). Ноль изменений поведения.

**ЧТО:** `x-required-roles`/`RolesGuard` (грубый) без изменений; слой CASL/`AbilityFactory` дополнительно пересекает scope AGENT; scope только сужает.
**ПОЧЕМУ:** Двухслойный guard должен продолжать работать; scope — defense-in-depth *внутри* существующей модели, а не замена.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Нет churn контракта/соглашения (матрица остаётся авторитетной и single-source); scope-только-сужает гарантирует, что агент никогда не превысит задокументированный role-гейт; HUMAN-пути доказуемо без изменений (parity-тест, §5).

---

## §5 — Раскатка: dormant-form-first (прецедент миграции 0034)

По ADR-0022 / миграции 0034 (спящий junction `user_roles`) и правилу cost-of-change, это отгружается как **спящий шов**, HUMAN-поведение побайтово-идентично.

- **Сейчас (этот ADR + gated-slice):**
  1. Расширить тип принципала (`AuthPrincipal`/`AccessTokenClaims`) **опциональным** `scope` (заполняется только для AGENT; HUMAN = undefined = полная матрица роли). Только форма.
  2. Добавить **deny-by-default-ветку AGENT** в `AbilityFactory` (§1). Она **спит** — в MVP нет принципала AGENT (master-гейт [ADR-0036](0036-agent-credential-issuance.md) off), поэтому ветка никогда не срабатывает; HUMAN-путь побайтово-идентичен.
  3. Добавить валидатор scope (отклоняет `manage`/`all`).
  4. Зарезервировать `service_credentials.scope JSONB` (PROPOSED-набросок миграции ниже) — аддитивно, nullable, deny-by-default, N-1 safe.
- **Позже (активация агента, P-A):** обмен [ADR-0036](0036-agent-credential-issuance.md) заполняет JWT scope-claim из credential; щёлкнуть `agent_moderation`. **Без authz-переписывания** — шов уже там.
- **Parity-тест (DoD):** abilities HUMAN-принципала без изменений на каждой роли (побайтово-идентичны до-ADR); AGENT с **null** scope разрешается в **никакие** abilities (deny-by-default); AGENT со scope `moderation-agent` разрешается **ровно** в `matrix(MODERATOR) ∩ scope`; AGENT с `role='ADMIN'` **никогда** не разрешается в `manage:all`.

**PROPOSED-набросок схемы (этот ADR миграцию не пишет; backend реализует в agent-scope-slice):**
```sql
-- Least-privilege-грант abilities, встраиваемый в JWT AGENT при обмене (ADR-0036 §1).
-- NULL/пусто = deny-by-default (никаких abilities). Аддитивно, nullable → N-1 rolling-deploy safe.
-- Словарь: [{ "action": "read|create|update|delete", "subject": "<Subject>" }] — никогда "manage"/"all".
ALTER TABLE service_credentials
  ADD COLUMN IF NOT EXISTS scope JSONB;
```
Счётчик таблиц без изменений (только колонка, +0 таблиц).

**ЧТО:** Отгрузить шов scope спящим (тип принципала + deny-by-default-ветка AGENT + валидатор + зарезервированная колонка `scope`); HUMAN побайтово-идентичен; parity-тест это пиннит; активация позже заполняет JWT scope без переписывания.
**ПОЧЕМУ:** Шов дешевле всего до того, как Admin Slice 2 захардкодит human-only-authz, но не должен менять поведение MVP или обнажать живую агентскую авторизацию.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Переиспользует проверенный dormant-form-first-паттерн (миграция 0034); parity-тест делает «ноль изменений HUMAN-поведения» и «deny-by-default для AGENT» *проверенными*, а не заявленными; аддитивная/nullable-колонка N-1 safe (учитывает AUDIT4 P1-5); активация — один шаг populate-the-claim, соблюдая правило фазирования.

---

## Последствия

### Положительные
- AUDIT4 P1-6 закрыт на уровне формы: AGENT **никогда** не может унаследовать `manage:all`; эффективная власть — явное, least-privilege, deny-by-default-пересечение — ограниченный, убиваемый радиус поражения (ADR-0006 #4).
- Один authz-путь сохранён (ADR-0011 §5); RBAC-матрица остаётся единственным авторитетным потолком; ортогональность ADR-0011 §7 цела (без cross-column CHECK; семантика ролей идентична).
- Safety-паттерн moderation обобщён в переиспользуемый четырёхчастный agent-operable-action-контракт (снапшот + scope + autonomy-toggle + override), готовый для admin/report (AUDIT4/architect #2).
- Human override и человеческое авторизационное превосходство сохранены безусловно.

### Отрицательные
- Словарь scope + валидатор для поддержки; дублирование scope между credentials, пока (если) не появится таблица профилей.
- Одна аддитивная колонка сверх формы [ADR-0036](0036-agent-credential-issuance.md).

### Нейтральные
- Поведение MVP побайтово-идентично (HUMAN-путь не тронут; ветка AGENT спит, агент не провижионен).
- Переедет ли scope позже в таблицу именованных профилей — отложено (оба разрешаются в один JWT-claim).

## Открытые вопросы (владельцу — рекомендация дана, не блокирует)
1. **[владелец/Северная звезда] Будущий тир «доверенного агента» с широким scope?** Видение P-D — всё более автономные агенты. Рекомендация: даже **широчайший** scope агента остаётся **явно перечисленным** грантом `{action, subject}` — wildcard `manage`/`all` остаётся **human-only навсегда**. Агенту можно предоставить *широкие* полномочия, но никогда *wildcard*-полномочия (так грант всегда аудируем и ограничиваем). *По умолчанию, если без ответа: никакого wildcard для AGENT, никогда.*
2. **[дизайн, минор] Эволюция хранения scope** — поднять per-credential-scope до таблицы именованных `agent_capability_profiles`, когда флот вырастет? Рекомендация: per-credential сейчас (Вариант A); поднять, когда >~горстки агентов делят scope. *Не блокирует (аддитивно позже).*

## Связанные решения
- [ADR-0011](0011-agent-principal-actor-model.md) — уточняет §7 для authz-слоя (матрица = потолок, эффективные AGENT = потолок ∩ scope); без cross-column CHECK; §3 human-override не тронут.
- [ADR-0006](0006-ai-agents-operate-platform.md) — реализует непреложное #4 (scoped least-privilege) и сохраняет #3 (override).
- [ADR-0036](0036-agent-credential-issuance.md) — парный; credential/JWT несёт определённый здесь scope. Поодиночке ни один ADR не разблокирует Северную звезду (бессилен vs сверх-полномочен).
- [ADR-0022](0022-multi-role-user.md) — прецедент dormant-form-first (миграция 0034); учесть взаимодействие role⟂principal_type, если AGENT когда-либо держит несколько ролей (эффективные = ⋃matrix(roles) ∩ scope).

## Ссылки
- `AUDIT4_HARDENING.md` §2 P1-6, §4a (scoped-ability BLOCKED), §4c #4, §6 (ADR-трек).
- `AUDIT4/security.md` §STRATEGIC FC-2 (`ability.factory.ts:46-84`, BLOCKED-список #1); `AUDIT4/architect.md` §4a scorecard + anti-North-Star debt #2 (обобщить паттерн).
- `backend/src/lib/auth/ability.factory.ts:51` (`case 'ADMIN': can('manage','all')`), `principal.ts` (`AuthPrincipal`, `AccessTokenClaims`), `policies.guard.ts`, `roles.guard.ts`.
- `backend/src/modules/moderation/moderation.service.ts:289` (`agent_moderation` per-domain autonomy-toggle — эталонный предел).
- `docs/specs/security/rbac-matrix.md` (грубая матрица / потолок `x-required-roles`).
- `database_schema.sql:1194` (`service_credentials`), `feature_toggles` (:651).
- `IMPLEMENTATION_PLAYBOOK.md §5` (граница фазы / dormant-form-first / rewrite-тест).
