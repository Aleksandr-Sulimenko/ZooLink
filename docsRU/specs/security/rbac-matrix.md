---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Спецификация: RBAC-матрица прав (роли × ресурсы)

## Результат
Сделать авторизацию реализуемой без догадок. Определяет конкретную матрицу роль→ресурс→действие и правила
объектного уровня (владение), которые бэкенд обязан применять через CASL + NestJS Guards
([ADR-0001](../../04-decisions/0001-tech-stack.md), `security/security_specification.md`). Это нормативный источник
для деклараций `x-required-roles` в OpenAPI-контрактах (`docs/03-architecture/api-contracts/`).

## Роли
`USER` (по умолчанию), `BREEDER`, `FARMER`, `MODERATOR`, `ADMIN`, `VETERINARIAN`, `GROOMER` (CHECK `users.role`).
`principal_type` может быть `HUMAN` или `AGENT` ([ADR-0006](../../04-decisions/0006-ai-agents-operate-platform.md),
[ADR-0011](../../04-decisions/0011-agent-principal-actor-model.md)) — AGENT держит операторскую роль (напр. MODERATOR)
и подчиняется **той же** матрице (`principal_type ⟂ role`, ортогональны). **ФОРМА** agent-principal и agent
**service-auth** закладывается сейчас и forward-compatible (ADR-0011): источник-агностичный principal через цепочку
authenticator'ов внутри монолита (`BearerJwt` сейчас, `AgentServiceToken` добавляется аддитивно потом, ADR-0009),
снапшот действующего принципала на каждый append-only ledger актёра (`audit_log.actor_principal_type`,
`moderation_decisions.actor_principal_type` + `actor_role`), env signing-секрет (≥32) + форма
хранимого/ротируемого/отзываемого service-credential внутри монолита. **Активация поведения AGENT — за feature-gate,
DEFAULT `'HUMAN'`** — ни один агент не активен и ни один service-токен не выдан, пока гейт выключен (как гейтится
Payment). Неприменимость к AGENT human-only контролей (MFA, лимит сессий) остаётся за этой активацией. MVP работает
только с HUMAN, но форма схемы/контракта/authz уже agent-ready (без будущего переписывания).

BREEDER/FARMER/VETERINARIAN/GROOMER = USER + доп. возможности (видимость для разведения, livestock-объявления и т.д.);
наследуют все права USER (additive-модель). MODERATOR и ADMIN — операторские роли. Набор из 7 ролей выше — канон;
**SUPER_ADMIN НЕ является значением `users.role`** (break-glass/супер-админ моделируется вне enum — ADR-0011 §7).
Org-членство — отдельная ось: `organization_users.role_in_org = {OWNER, ADMIN, STAFF, VET}` (MODERATOR — **не**
валидный `role_in_org`: модерация — платформенно-операторская роль, не роль org-членства).

> **(round-7, normative) — форма agent-principal и service-auth закладывается сейчас (forward-compatible), поведение gated.**
> **ЧТО:** заменено «agent-service-auth deferred to Фаза 2» на «ФОРМА agent-principal/service-auth закладывается
> сейчас (forward-compatible), АКТИВАЦИЯ поведения AGENT — за feature-gate, DEFAULT HUMAN»; зафиксирован 7-ролевой
> канон, additive-модель, SUPER_ADMIN вне `users.role`, `principal_type ⟂ role`, `role_in_org`={OWNER,ADMIN,STAFF,VET}.
> **ПОЧЕМУ:** append-only ledger'ы (`audit_log`/`moderation_decisions`) необратимы — отсрочка формы актёра =
> переписывание истории (rewrite-test = да); прежняя формулировка «deferred» противоречила правилу фаз
> (`IMPLEMENTATION_PLAYBOOK §5`).
> **ПОЧЕМУ ТАК ЛУЧШЕ:** один authz-путь и одна матрица остаются авторитетными; активация агентов позже = один
> дополнительный authenticator + флаг гейта, без переписывания схемы/контракта/authz; согласовано с ADR-0006
> (immutable audit, scoped credentials) и ADR-0009 (всё внутри монолита); MVP-поведение не меняется (DEFAULT HUMAN).

## Принципы
- **Запрет по умолчанию.** Никаких прав без явной выдачи (least privilege).
- **Двухслойное применение.** Грубая проверка роли в guard-слое; **объектная проверка владения** в сервис-слое (defense in depth).
- **Владение = актор владеет агрегатом** (напр. `animal.owner_id == user.id` или через `organization_users` для
  org-владения); MODERATOR/ADMIN обходят владение только в рамках своей операторской области.

## Матрица (C=create, R=read, U=update, D=delete/деактивация; `own`=только свои; `—`=запрещено)

| Ресурс | USER (+breeder/farmer/vet/groomer) | MODERATOR | ADMIN |
|---|---|---|---|
| **Auth/сессия** (register, login, refresh, logout) | C/own | C/own | C/own |
| **Свой профиль** | R/U/D own | R/U own | R/U/D any |
| **Чужие профили** | R (публичные поля) | R (полные) | R/U/D |
| **Роли/статус пользователя (suspend)** | — | suspend/unsuspend (по модерации) | C/R/U/D |
| **Животные** | C/R/U/D own | R any | R/U/D any |
| **Передача владения животным** ([ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md)) | текущий владелец инициирует/отменяет свою; названный получатель принимает/отклоняет входящую | R | R/U |
| **Объявления** | C/R/U/D own (R любые активные) | R any (вкл. pending) | R/U/D any |
| **Решение модерации по объявлению** | — | C (approve/reject/changes) | C |
| **Очередь модерации** | — | R | R |
| **Жалобы на контент** | C/own, R own | R/U (resolve) | R/U/D |
| **Беседы/сообщения** (Фаза 2+) | C/R own | R (для модерации) | R |
| **Организации / филиалы** | R; C/U/D если org-admin (`organization_users.role_in_org`) | R | C/R/U/D |
| **Членство в организации** | управлять если org-admin | R | C/R/U/D |
| **Справочники** (species, breeds, cities) | R | R | C/R/U/D |
| **Feature toggles / системный конфиг** | — | — | C/R/U/D |
| **Шаблоны уведомлений** | — | — | C/R/U/D |
| **Уведомления (свои)** | R own, управление prefs | R own | R any |
| **Платежи / возвраты** (Фаза 2+, gated) | C/R own | R | R/U (refund) |
| **Цифровые активы / NFT** (Фаза 2+, gated) | R own | R | R/U |
| **Журнал аудита** | — | R (свои действия) | R all |
| **Избранное / сохранённые поиски** | C/R/U/D own | own | own |

> **(round-8, нормативно) — права передачи владения — реальные MVP-правила (ADR-0013).**
> **ЧТО:** Заменено «инициировать/подтвердить own (в MVP заблокировано)» на фактические MVP-права: текущий владелец
> инициирует/отменяет свою передачу; названный получатель принимает/отклоняет входящую; MODERATOR = R, ADMIN = R/U
> (override). Строка одинакова при любом `principal_type` (ADR-0011 §7).
> **ПОЧЕМУ:** «в MVP заблокировано» противоречило апекс-требованию (BR animal-domain:56-61, GAP-TRACE-007), которое
> ратифицировано [ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md): передача — в MVP (упрощённый прямой флоу).
> **ПОЧЕМУ ТАК ЛУЧШЕ:** RBAC-матрица перестаёт врать о «заблокированности»; гварды получают однозначные права
> (initiate/cancel = инициатор-владелец, accept/decline = получатель, R/U = ADMIN); owner-lock остаётся защитой
> в глубину (только контролируемый путь через GUC). Согласовано с [ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md) §1/§5.

## Правила объектного уровня (владение) — применять в сервис-слое
- **Животное:** изменяемо только `owner_id == актор` ИЛИ актор — org-admin `organization_id`. Неизменяемые поля
  (species_id, sex, date_of_birth, breed_id) блокируются триггером независимо от роли.
- **Передача владения** ([ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md)): только **текущий владелец**
  животного (нынешний `owner_id` или org-admin нынешнего `organization_id`) может **инициировать** передачу; только
  **названный получатель** (`to_user_id`/`to_organization_id`) может **принять** или **отклонить**; только **инициатор**
  может **отменить** ещё `PENDING`-передачу. MODERATOR = R, ADMIN = R/U (override). Та же строка матрицы применяется
  независимо от `principal_type` (HUMAN или AGENT может инициировать/принять; ADR-0011 §7). Триггер owner-lock в БД
  блокирует любое изменение `owner_id`/`organization_id` **кроме** контролируемого пути передачи (GUC `app.ownership_transfer`).
- **Объявление:** изменяемо только `seller_id == актор` ИЛИ org-admin его `organization_id`.
- **Беседа/сообщение:** видимы только `participant_a_id`/`participant_b_id` (+ MODERATOR для ревью).
- **Жалоба:** заявитель видит свои; MODERATOR/ADMIN видят все.
- **Платёж:** пользователь видит только свои `payment_transactions.user_id == актор`.
- **MODERATOR/ADMIN обходят** владение только в рамках области выше — никогда молча для несвязанных записей.

## Замечания по реализации
- Кодировать как CASL `defineAbilitiesFor(user)`; один набор abilities на роль, композиция (BREEDER = USER + extras).
- `RolesGuard` читает `x-required-roles` (`@Roles()`); `PoliciesGuard` проверяет объектный уровень по загруженному ресурсу.
- Публичные (без auth): register/login/refresh, чтение активных объявлений, geo-search/geocode, чтение справочников.
  Всё остальное требует валидный JWT.

## Связанное
- [Спецификация безопасности](security_specification.md) · [ADR-0001](../../04-decisions/0001-tech-stack.md) ·
  [ADR-0006](../../04-decisions/0006-ai-agents-operate-platform.md) ·
  [ADR-0011](../../04-decisions/0011-agent-principal-actor-model.md) (модель актёра-агента, канон ролей) ·
  [ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md) (авторизация передачи владения в MVP) ·
  [Домен Identity](../01-identity-domain.md) · [Домен Admin](../06-admin-domain.md)
- 🌐 EN: [docs/specs/security/rbac-matrix.md](../../../docs/specs/security/rbac-matrix.md)
