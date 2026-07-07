# 🔥🔥🔥 HYPER³ — RE-AUDIT (same axes) + NEW UNFORESEEN AXES + TRASH-TEST — next-session launcher (v3)

> **Paste the block below as the FIRST message of a FRESH session** (clean context, ideally a
> **strong model**). Enter the **zoolink arena**. Everything is on branch `backend`, **PUSHED** to
> `origin/backend` (HEAD `a23a58f`). This is **round 3**: re-run the whole audit *independently* on the
> SAME axes, add **NEW axes rounds 1–2 never examined**, and run a deliberate **TRASH-TEST** (chaos /
> adversarial / fuzz / load / resilience), then **group/reconcile** against round 1 (`AUDIT2*`) and
> round 2 (`AUDIT3*`). Rounds 1–2 (Opus 4.8 / Fable 5) found the dead-marketplace + anti-rewrite gaps;
> those are now FIXED (fix-program Waves A–G). Round 3 must **stress the fixes themselves** and hunt what
> a green suite still masks.

---

СТАРТ! Ты — оркестратор. Заходим в арену **zoolink**. Запусти **HYPER³** — сквозной ре-анализ + тестирование силами **ВСЕХ 18 спецов** (16 + **psychologist** + **active-user**), ТРИ линзы: **(1) те же оси, что раунды 1–2**, **(2) НОВЫЕ ранее-не-предвиденные оси**, **(3) ТРЕШ-ТЕСТ** (хаос/adversarial). И **сверь с раундами 1 и 2**.

## СОСТОЯНИЕ (на момент запуска, ветка `backend`, HEAD `a23a58f`, ЗАПУШЕНО в origin)
Fix-программа по HYPER²-аудиту **ЗАКРЫТА** (Волны A–G, 16 коммитов, все через gate). Durable-итог: память **`zoolink-audit3-fix-program-2026-07`** + `zoolink-hypertest2-forward-compat-2026-07-02` (round-2) + `zoolink-hypertest-forward-compat-2026-07-02` (round-1).
- **Baseline (проверен реальным прогоном):** **610 unit / 289 e2e + 9 todo зелёные, ZERO RED**; миграции **0001–0034**, **37 таблиц**; CI market grep-gate активен.
- **Что построено в fix-программе (это и есть главные цели стресса round-3):**
  - contact-exchange ОЖИВЛЁН: `consents` (append-only, mig 0029), writer `PATCH /me`, `show_phone` default OFF, `revealContact` гейт по согласию + billing-unit fix + dedup (ADR-0020).
  - notification: первый живой outbox-consumer → `notification_logs` IN_APP (mig 0030), forward-only replay (ADR-0021).
  - transfer counterparty: claim-code (Redis, single-use, enum-oracle closed).
  - security: dev-token fail-closed, refresh→HttpOnly cookie, JWT HS256 pin, avatarUrl/telegram/photo https-allowlist, animal 403→404, /metrics guard + METRICS_TOKEN prod-required.
  - анти-рерайт швы: OfferingRef (mig 0032), derived-market cache `listings.market` (mig 0033) + **ADR-0018 узел закрыт** (все 5 market-читателей на кэше, CI grep-gate `scripts/check-no-raw-market-join.sh`), user_roles junction DORMANT (mig 0034), value-event offeringType/offeringId, geo_anchor reserved, monetization_type SPEC-ONLY.
  - shared authz: `OrgMembershipService.isPartyOrOrgAdmin` + `isVisibleToActor`/`assertCanReadOrNotFound`.
  - favorites controller (own-scope, DELETE-204-leak-free), view-count capture (mig 0031), RF-residency guardrail (ADR-0017).
- **Артефакты прошлых раундов:** `AUDIT2_FORWARD_COMPAT.md`+`AUDIT2/*` (round-1), `AUDIT3_FORWARD_COMPAT.md`+`AUDIT3/*` (round-2), `backend/test/audit2-*.e2e-spec.ts` (BLOCKER теперь GREEN; **9 `it.todo` осталось** — непостроенные поверхности).

## МИССИЯ (ТРОЙНАЯ)
1. **РЕ-АУДИТ ПО ТЕМ ЖЕ ОСЯМ (независимо, затем reconcile).** Каждый спец сначала выводит сам (свежие глаза), линза — forward-compat/анти-рерайт + application-security + BR-трассировка (как раунды 1–2). Потом diff против `AUDIT2/<role>.md` И `AUDIT3/<role>.md`: **NEW / CONFIRMED / REFUTED / SEV-CHG / FIXED-VERIFIED** (пятая категория: подтверди что fix-программа реально закрыла находку, а не замаскировала). ГЛАВНОЕ: fix-программа изменила много кода — **предполагай, что фиксы могли (а) что-то новое сломать, (б) снова маскировать зелёными тестами**. Grep таблиц/поведений без writer'а/consumer'а (как contact_reveals) — заново.
2. **НОВЫЕ ОСИ (ранее не предвиденные).** Раунды 1–2 смотрели на forward-compat, security-seams, dead-features, BR-drift. Round-3 добавляет оси, которых НЕ было:
   - **Concurrency-at-scale / race-storms:** новые пути (consent opt-in↔reveal, claim-code consume, favorites dedup P2002, notification idempotency, market-cache recompute, transfer accept) под параллельной нагрузкой и retry-штормом. TOCTOU за пределами найденных.
   - **Performance / N+1 / write-on-read:** view-count инкремент на КАЖДОМ detail-GET (scale-риск), notification-consumer throughput, market-cache, discovery-CTE, `animalIdsForSpecies` materialize (Phase-2 нит), Prisma N+1.
   - **Resilience / partial failure:** поведение при падении Redis/PG посреди операции (reveal, claim-code, escalation-tick, outbox relay); idempotency под дублями; outbox no-purge-guardrail реально ли держит аналитику.
   - **Data-integrity / migration-replay:** прогон миграций 0001→0034 на ЧИСТОЙ БД + seed×2 + **N-1 upgrade** (частично покрыто CI drift-gate — проверь глубже); derived-market drift; consents append-only под adversarial; user_roles dormancy РЕАЛЬНО ли не даёт прав в каждом authz-пути.
   - **Deeper agent-as-principal (ADR-0006/0011):** AGENT-principal через ВСЕ новые пути (consent-запись, notification, claim-code, favorites, moderation) — снапшоты, human-override, не-обход.
   - **Economics-at-scale / abuse (finance+growth+active-user):** claim-code как spam-вектор, contact-reveal quota-gaming ПОСЛЕ billing-fix, listing-flood (не построен quota — verify), favorites/view-count накрутка, Sybil.
   - **i18n / encoding / boundary:** unicode/emoji/RTL в localized-полях, host-header unicode в media-allowlist, огромные payload'ы, числовые границы (priceCents overflow, radius, TTL).
3. **ТРЕШ-ТЕСТ (deliberate chaos/adversarial — НОВОЕ для round-3).** Намеренно враждебный прогон по КАЖДОЙ поверхности:
   - **Garbage/fuzz input:** мусор/битый JSON, null-байты, гигантские строки, глубоко-вложенный JSON, SQL/NoSQL/prompt-injection в каждое поле, malformed UUID/ETag/Idempotency-Key/claimCode/cookie.
   - **Resource exhaustion:** флуд запросов, огромные списки, pagination-abuse, множество параллельных reveal/claim/favorite, Redis-key-заполнение.
   - **Adversarial sequences:** race-storm на guarded-writes (double-accept transfer, double-consume claim-code, concurrent opt-in/withdraw consent, concurrent favorite/unfavorite), replay украденного refresh-cookie, dev-token в кривых NODE_ENV, media-allowlist обход (CDN-host injection, `@`-трюки, unicode-host, redirect).
   - **Clock/TTL skew:** claim-code TTL на границе, SLA-escalation пороги, cookie/JWT expiry, consent policy_version.
   - **Dependency failure injection:** убить Redis/PG посреди tx, задержки, разрыв соединения — система должна деградировать безопасно, НЕ раскрывать данные, НЕ терять инварианты.
   Каждый треш-кейс: ожидаемое безопасное поведение (4xx/deградация/отказ), НЕ 5xx-с-утечкой, НЕ порча данных, НЕ обход authz/consent/market-separation.

## ЗАМЕТКИ — куда смотреть в первую очередь (round-3 hot-spots)
1. **Стресс самих фиксов:** consent-гейт непробиваем под гонками? billing-unit не жжёт квоту при гонке пустого reveal? claim-code single-use под double-consume? notification idempotency под дублями relay? market grep-gate не обходится новым сырым join'ом? user_roles dormancy держит под каждым authz-путём? refresh-cookie rotation под кражей/replay?
2. **Что фиксы могли сломать/замаскировать:** новые тесты зелёные — ищи, где они маскируют (фикстуры в обход writer'ов, produce-без-consume, happy-path без негатива). 9 оставшихся `it.todo` — какие теперь строятся, какие честно deferred.
3. **Новые attack-surface от fix-программы:** claim-code, cookie-auth, media-CDN-allowlist, /metrics-token, RF-residency env, derived-market recompute (admin species-fix → массовый update).
4. **Scale/perf оси** (раунды 1–2 их не мерили): view-on-read, consumer throughput, N+1, materialize.
5. **Migration-replay + N-1 upgrade** на чистой БД (0001→0034).
6. **Открытые тикеты** (не блок, но проверить): `animal.getById` CASL owner-only vs listScope org-admin дивергенция; `/api/v1` vs `/v1` канон; ecosystem-BR-018+ не в requirements-каноне.

## КАК ГНАТЬ (дисциплина — ОБЯЗАТЕЛЬНО)
- **Каждый агент пишет ПОЛНЫЕ находки + diff-к-раундам-1&2 в `ZooLink/AUDIT4/<role>.md`, оркестратору — резюме ≤150 слов.** Формат: `[severity][критерий][ось: same|new|trash][NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED] файл:строка → проблема/треш-кейс → фикс`. Не выдумывать; неуверен → «требует ручной проверки». Делегаты **НЕ коммитят**, продуктовый src НЕ меняют (треш-тесты = НОВЫЕ тест-файлы; вскрытый баг → 🔴-находка оркестратору, чинить отдельным гейт-слайсом).
- **Тест-ресурс общий** (host PG/Redis localhost:5432/6379): **ОДИН тест-прогон за раз**, `redis-cli flushall` первым, `--runInBand` при флапе rate-limit ([[zoolink-e2e-host-services]]). Doc-only линзы — параллельно. Батчи агентов ~5–6 (большие фан-ауты ловят rate-limit).
- **⚠️ MIGRATION-LOCATION TRAP:** новые миграции пиши ТОЛЬКО в `ZooLink/migrations/` (не workspace-root) — round-2 ловил 0030/0031 не там.
- **Проектные роли ЗАРЕГИСТРИРОВАНЫ как subagent-типы** (спавнь напрямую architect/backend-engineer/security/reviewer-qa/… — не «claude adopts role»).
- **Baseline-floor:** сначала прогони весь `backend/test` + `scripts/check-no-raw-market-join.sh` (ожидаемо 610u/289e+9todo, grep-gate green) — это регрессия-этаж перед треш-тестом.

## ФАЗЫ
**Фаза 1 — active-user (needs-first + adversarial):** пройди КАЖДУЮ персону first-person по РЕАЛЬНО построенному (теперь маркетплейс живой!) — и как честный юзер, и как злоумышленник (треш). Вердикт «вернусь ли» + misuse → security. → `AUDIT4/active-user.md`, сверь с AUDIT2+AUDIT3.
**Фаза 2 — все спецы параллельно (3 линзы + reconcile):** каждый (a) выводит сам по 3 осям (same/new/trash), (b) diff к своим `AUDIT2/<role>.md`+`AUDIT3/<role>.md`, (c) даёт тест/треш-пробы. architect держит per-seam forward-compat + новые оси (concurrency/perf/resilience). security ведёт треш-adversarial + exploit-chains. reviewer-qa — маскировку + migration-replay + N-1. legal/finance/growth — record-only по launch-gate (владелец отложил юр/секреты/монетизацию к релизу), но abuse-economics и consent-механику стрессуют. → `AUDIT4/<role>.md`.
**Фаза 3 — ГИПЕР-ТЕСТ + ТРЕШ-ТЕСТ:** baseline-floor → реализуй НОВЫЕ негатив/concurrency/perf/resilience/fuzz-инварианты на КАЖДУЮ поверхность (особенно fix-программные) → прогони треш-кейсы → расширь `it.todo` где построилось. Всё зелёное или 🔴 задокументирован. → `AUDIT4/PHASE3_HYPERTEST.md`.
**Фаза 4 — синтез + reconcile:** сведи `AUDIT4/*` → **`ZooLink/AUDIT4_HARDENING.md`** с **diff-таблицей раунд1↔2↔3** (NEW/CONFIRMED/REFUTED/SEV-CHG/FIXED-VERIFIED) + объединённым приоритизированным списком (P0–P4) + отдельной **секцией TRASH-TEST results** (что выдержало, что нет). Durable-память. **Коммит — по явной команде владельца.**

## КОНТЕКСТ ВЛАДЕЛЬЦА (учесть при приоритизации)
- **Бэк ещё дорабатывается, фронт на стадии деплоя.** Фокус round-3 = **backend-хардненинг + forward-compat + треш-устойчивость** (активная зона).
- **Launch-gate пункты ОТЛОЖЕНЫ владельцем к релизу** (юр-публикация/РКН, ротация секретов, RF-зоны, модель монетизации — win-win/soft-start): в аудите они **record-only, НЕ блокеры сейчас**, но фиксируй их состояние.
- Владелец ценит **efficiency·accuracy·productivity; measure, don't assume**; коммуникация human-first; **always ask before commit**.

Начни с заземления (прочитай `zoolink-audit3-fix-program-2026-07`, `AUDIT3_FORWARD_COMPAT.md` §Attention + 2–3 острых `AUDIT3/<role>.md`, `git log --oneline -20`, прогони baseline-floor), дай короткий план (кого на что по 3 осям) и запускай Фазу 1.
