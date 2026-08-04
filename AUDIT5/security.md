# AUDIT5 · ось №5 «не захватываем чужое» — security

> Записано оркестратором из возврата лейна security (лейн по своему правилу файл не пишет).
> Метод: статический разбор июльской волны + ЖИВАЯ проверка (2 одноразовых e2e-зонда против host
> PG16/Redis, HEAD c44874c). Продуктовый src/ не менялся; зонды удалены, стенд восстановлен.
> Базовые сьюты не перегонялись. **Вердикт: 🔴 NO-GO для любой агент-власти; GO-with-controls для
> человеческого периметра.**

## Оркестраторская верификация (независимая, ADR-0020)
- P0-1 (PoliciesGuard fail-OPEN): `policies.guard.ts:39` `if (!handlers || handlers.length === 0) return true;` — ПОДТВЕРЖДЕНО чтением.
- P1-1 (секрет в Redis 24ч): подтверждено security живым замером (containsSecret:true, ttl 86400).
Оба несущих P0 приняты как CONFIRMED.

## P0-1 · Периметр ADR-0037 не является точкой принуждения — скоуп действует на 1 маршруте из 83 · ЖИВЬЁМ
`policies.guard.ts:39` fail-OPEN. Скоуп AGENT живёт только в `AbilityFactory` (`ability.factory.ts:52-58`),
вызывается лишь из `PoliciesGuard` + 3 мест `animal.service.ts:122,184,428`. `@CheckPolicies` во всём
коде ОДИН — `auth.controller.ts:85` (тестовый `/v1/auth/operator-check`). 83 маршрута, 1 политпроверка.
Реальный замок везде — `RolesGuard`, принципал-агностичен (`roles.guard.ts:31-44`, читает только role).
ADR-0037:141 утверждает «для AGENT роль необходима, но НЕ достаточна» — **на 100% поверхности неверно:
достаточно роли**. Живое: агент scope=undefined → operator-check 403, queue/reasons/decisions 200.
**Фикс (архитектору, поправка ADR-0037):** `PoliciesGuard` fail-CLOSED для AGENT (маршрут без policy-handler
⇒ 403 при principalType==='AGENT'), HUMAN-ветка байт-в-байт прежняя. Одна строка = deny-by-default везде
(расстановка @CheckPolicies на 83 маршрута нарушает закон №10 — забудут молча). Антарая: бхранти-даршана
(шов объявлен принуждающим, а измеряет не то — не подключён).

## P0-2 · AGENT-ADMIN открывает свои же ворота · ЖИВЬЁМ
`system-setting.controller.ts:20` только `@Roles('ADMIN')`; `system-setting.service.ts:79-110` → `FeatureToggleService.flip`,
там лишь `actor.role!=='ADMIN'` (`feature-toggle.service.ts:65`). Живьём (principal AGENT+ADMIN):
PATCH /v1/system/settings/agent_service_auth → 200 (агент включает свой мастер-гейт). Структурно закрыт
только выпуск кредов (`agent-credential.service.ts:199` assertHumanActor). **Фикс:** все агент-ограничивающие
ворота (agent_service_auth, agent_moderation) — HUMAN-only на записи. Антарая: стьяна (замок держится изнутри).

## P0-3 · Человеческие сессионные пути чеканят AGENT-токен без скоупа · ЖИВЬЁМ
`auth.service.ts:40-45` (refresh), `identity.service.ts:170-175` (verifyPhone), `:261-266` (oauthLogin),
`recovery.service.ts:150-155` (verifyEmail) — строят principalType из user, scope НЕ передают, на
agent_service_auth не смотрят. Живьём: POST /v1/auth/refresh при ВЫКЛЮЧЕННОМ гейте → 200, принципал
{MODERATOR, AGENT}, queue 200. AGENT-аккаунт с подтверждённой почтой/OAuth/телефоном = бессрочная
агент-сессия мимо ADR-0036 (rate-limit/expiry/revoke/profile). AGENT-аккаунты сегодня заводятся только
руками в БД → forward-compat, не живая эксплуатация; но «гейт выключен» ≠ контроль. **Фикс:** сессионные
пути отказывают AGENT-принципалу (401/403) либо форс-резолвят скоуп из активного крединтала.

## P1-1 · Открытый секрет агента в Redis 24 часа · ЖИВЬЁМ
`admin-agent-credential.controller.ts:40,53` вешает IdempotencyInterceptor на issue/rotate; тот кэширует
тело ответа целиком (`idempotency.interceptor.ts:112-124`, EX 86400). Тело = `secret=zlk_agent_<credId>_<секрет>`.
Замер: containsSecret true, prefix 'zlk_agent_', ttl 86400. Опровергает код-док (`agent-credential.service.ts:50-52`)
и ADR-0036 («never persisted»). Побочно: повтор того же Idempotency-Key ({} коллизионно) отдаёт СТАРЫЙ секрет.
**Фикс:** снять IdempotencyInterceptor с секрето-возвращающих маршрутов (дедуп на БД) либо no-cache-body список.
Антарая: бхранти-даршана (док утверждает «только обмен, только хеш» — код кладёт plaintext).

## P1-2 · Обмен не смотрит на user.status (SUSPENDED агент получает токен) · ЖИВЬЁМ
`agent-credential.service.ts:165-171` проверяет is_active/revoked_at/expires_at/principal_type/user.is_active,
но НЕ user.status (человеческие пути: `auth.service.ts:12` BLOCKED_STATUSES, `identity.service.ts:41`).
Живьём: status='SUSPENDED', is_active=true → обмен 200. Писателя SUSPENDED в коде пока нет → заряженное ружьё.
**Фикс:** переиспользовать BLOCKED_STATUSES в exchange (1 строка). Антарая: анавастхитатва (замок статуса
достигнут в человеческих путях, не удержан в агентском).

## P2 (чтением, не живьём)
- **agent_moderation — гейт без строки:** `moderation.service.ts:289` гейтит AGENT-решения по ключу, которого
  нет ни в схеме, ни в миграциях (в БД 404). fail-safe (отсутствующий ключ=false), но невидим оператору. Досеять как agent_service_auth.
- **rotate/revoke игнорируют agentUserId из пути** (`admin-agent-credential.controller.ts:56,69` param `_agentUserId` не used):
  rotate по любому uuid сработает. Эскалации нет (ADMIN глобален), но объект-в-пути≠объект-действия портит аудит. Фикс: сверять + 404-no-leak.
- **Отзыв не убивает выданный AGENT-JWT** — до 15 мин власти после revoke (нет jti/deny-list). Задокументировать риск или deny-list.
- **trust proxy не настроен** (`main.ts`): публичный POST /v1/auth/agent/token лимит по ip (60/час) за Caddy = один общий ковш на весь интернет. → devops ранбук (hop-count, без XFF-спуфинга AUDIT4 TRASH-M1).
- **assertProfileExists не проверяет is_active** (`agent-credential.service.ts:222-231`): кред на выключенный профиль; fail-safe (resolveScope→undefined), косметика.

## ДЕРЖИТ (позитив, перепроверено)
- GET /v1/me/notifications own-scope структурно (`notification-read.service.ts:40`), IDOR закрыт.
- H4-матчер (`saved-search-match.consumer.ts:236-274`) полностью параметризован (q через strpos связанным),
  продавцу себя не шлём, market-якорь ADR-0002 без кросс-маркет-утечки, fan-out ≤500 с WARN, filters белый список.
- Репутация FORM (0039/0040) реально спящая — вне transfer.service ни чтения, ни записи; эндпоинтов нет.
- Выпуск кредов — единственное место реальной проверки principalType (assertHumanActor), e2e пинует.
- Обмен: единый 401 на все промахи, UUID-предфильтр, безусловный HMAC, лимиты credId+IP, секрет не в аудит/лог, каскад-отзыв при erase/деактивации.

## Пустые клетки (объявлены)
- Динамический пентест живого сервера, гонки/конкурентность agent-auth, фаззинг тела обмена — НЕ гонялись.
- Прод-конфиг (trust proxy, edge-лимиты, env) — ручная проверка devops.
- Реальный путь появления AGENT-аккаунта в прод — вне кода, не проверялся (P0-3 исходит из «строка в БД есть»).
- OAuth/recovery пути подтверждены чтением, не запуском (живьём гонялся refresh через dev-token).

## Гигиена стенда
agent_service_auth возвращён OFF; временная строка agent_moderation удалена (в БД снова 14 тогглов); тестовые
креды/refresh удалены; зонды стёрты; git продукта чист. **Осталось 4 тест-юзера x5%** — не удалить (audit_log
append-only рубит каскад), тот же след, что штатная `agent-auth.e2e-spec.ts` (24 юзера AA-%). → janitor/reviewer-qa:
у e2e-сьют с записью в аудит нет рабочего teardown.

## Гейт
- Человеческий периметр волны — **GO-with-controls** (новых IDOR нет; /me/notifications, saved-search, репутация-FORM чисты).
- Любая агент-власть — **NO-GO**. Блок [NS] AUDIT4 ОТКРЫТ: измерение скоупа шипнулось (в CASL правильно — пересечение,
  без manage:all), но НЕ подключено к принуждению. До зажигания agent_service_auth в любой среде: (1) fail-closed
  PoliciesGuard для AGENT, (2) HUMAN-only запись агент-ворот, (3) отказ сессионных путей AGENT, (4) секрет вон из
  Redis-кэша, (5) status в обмене. 1–3 архитектурные (ADR), 4–5 узкие фиксы.

Память лейна: `backend/.claude/agent-memory/security/agent-scope-not-enforced-audit5.md`.

---
## Net-new (второй инстанс лейна, пере-верификация на c44874c — интегрировано оркестратором)
**Пере-верификация 4 несущих (ADR-0020): P0-1/P0-2/P0-3/P1-1 — все CONFIRMED повторным чтением.**
Урок для гейта: СТАТИЧЕСКИЙ проход дал бы agent-auth «GO-with-controls» (deny-by-default, manage:all
недостижим, единый 401, HUMAN-only issuance — в изоляции всё верно). ЖИВЫЕ зонды перевернули в NO-GO:
шов измерения scope не подключён к принуждению. «Зелёный CASL-юнит» ≠ «замок принуждает». Статики
недостаточно для гейта агент-периметра. Антарая: бхранти-даршана.

**AUDIT4 carry-forward на c44874c:**
- CLOSED ✅ consent tie-break fail-open (P1-2) → мигр 0036 seq GENERATED + orderBy seq DESC.
- CLOSED ✅ listing-flood/moderation-DoS → per-user суточная квота (listing.service.ts:209,687-713), fail-open by design.
- **OPEN ⏳ contact-reveal Sybil** — ключ пер-аккаунтный `contact-reveal:{market}:{viewerId}` (listing.service.ts:667),
  нет пер-seller/пер-listing капа; актуально — contact_phone пишется живьём. Класс: авирати (влечение к цели мимо абуз-предела).

**Два новых минора:**
- [MINOR/NS] ability.factory.ts:110-150 — даже после фикса P0-1: AGENT с role=ADMIN получает scope-гранты БЕЗ
  owner-условий (потолок ADMIN=manage:all без conditions) → `[{update,Listing}]` = «править ЛЮБОЙ». Наименьшая
  привилегия зависит от базовой роли → провижинить агентов от USER/MODERATOR, НИКОГДА ADMIN. Класс: расширение-полномочий.
- [MINOR] dto/agent-auth.dto.ts:57-61 — AgentTokenExchangeDto.credential без @MaxLength → много-МБ тело → безусловный
  HMAC над мегабайтами (agent-credential.service.ts:160) до загрузки. Фикс @MaxLength(~200). Класс: ресурс-исчерпание.

**Гигиена:** убран stray пустой `backend/test/zz-axis5-verify.e2e-spec.ts` (0 байт, ломал бы test:e2e). Продуктовый src не тронут.
