# 🔥🔥 HYPER² — SUPER-HYPER forward-compat RE-AUDIT + RECONCILE — next-session launcher (v2)

> **Paste the block below as the FIRST message of a FRESH session** (clean 1M context, ideally a
> **stronger model**). Enter the **zoolink arena**. Everything is on branch `backend`, **not pushed**.
> This is **round 2**: re-run the whole forward-compat hyper-audit *independently*, then **group/reconcile**
> against round 1 (`AUDIT2_FORWARD_COMPAT.md` + `AUDIT2/*.md`) — catch what round 1 missed, confirm or
> refute what it found. Round 1 was run 2026-07-02 on Opus 4.8; a stronger model is expected to go deeper.

---

СТАРТ! Ты — оркестратор. Заходим в арену **zoolink**. Запусти **HYPER²** — сквозной анализ + тестирование силами **ВСЕХ 18 спецов** (16 + **psychologist** + **active-user**), главная линза — **FORWARD-COMPAT / анти-рерайт**, и **сверь результат с раундом 1**.

## СОСТОЯНИЕ (на 2026-07-02, ветка `backend`, НЕ запушено)
Раунд 1 (HYPER forward-compat audit) закоммичен на `backend`. Артефакты:
- **`ZooLink/AUDIT2_FORWARD_COMPAT.md`** — сводный отчёт раунда 1 (severity-сводка, per-seam forward-compat вердикт, топ-конвергенция, конфликты, приоритеты P0–P4, **§Attention notes for the NEXT round** — читай в первую очередь).
- **`ZooLink/AUDIT2/<role>.md`** — 18 линз, полные находки + ~180 тест-проб; **`AUDIT2/PHASE3_HYPERTEST.md`** — гипер-тест раунда 1.
- **`backend/test/audit2-hypertest.e2e-spec.ts`** — proof-тесты (BLOCKER = намеренно RED, 4 abuse/security = GREEN); **`backend/test/audit2-forward-stubs.e2e-spec.ts`** — 11 `it.todo` наперёд.
- Память: **`zoolink-hypertest-forward-compat-2026-07-02`** (durable-итог) + `zoolink-crossteam-audit-2026-06-30` + `zoolink-predev-audit-state`.
- **Baseline (проверен реальным прогоном): 450 unit / 237 e2e зелёные**, миграции 0001–0028.

## МИССИЯ (двойная)
1. **НЕЗАВИСИМЫЙ ре-анализ.** Каждый спец **сначала выводит находки сам** (свежие глаза, не подглядывая в раунд 1) — иначе получим эхо-камеру. Линза — forward-compat/анти-рерайт: нет ли решений, принятых СЕЙЧАС, которые заблокируют развитие (схема/контракты/authz/actor-model/`market_scope`/Offering-шов 0014/monetization/мульти-роль/geo/крипто-шов/consent). Логика должна прослеживаться сквозь всё: BR → spec → ADR → schema → code → test.
2. **СВЕРКА (reconcile) с раундом 1.** Только ПОСЛЕ своего вывода открой соответствующий `AUDIT2/<role>.md` и построй diff: **NEW** (нашли сейчас, раньше упустили) · **CONFIRMED** (совпало) · **REFUTED** (раунд 1 ошибся / не воспроизводится) · **SEVERITY-CHANGED** (переоценка). Цель владельца — **сгруппировать оба раунда в единую, более полную и достоверную картину**; более сильная модель ⇒ ищи глубже, не softируй.

## ЗАМЕТКИ — куда смотреть в первую очередь (hot-spots раунда 1)
1. **Полный радиус BLOCKER contact-reveal** — не только пропавший writer: **есть ли ДРУГИЕ мёртвые фичи** «форма-в-схеме-есть, поведения-нет», спрятанные за зелёными фикстурами? (grep таблиц без writer'а/эндпоинта — как был `contact_reveals`.) Зелёный набор уже маскировал мёртвый маркетплейс — **предполагай, что маскирует ещё**.
2. **Каждый «form-now шов»** — раунд 1 утверждал: `OfferingRef`/`market_scope`/`monetization_type`/`roles[]`/`geo_anchor`/value-event **отсутствуют** (grep=0). Перепроверь сам + дай **точную дешёвую форму миграции** для каждого и проверь, нет ли частичного присутствия (`moderation_decisions` полиморфная пара, спящий FK `favorites`).
3. **ADR-0018 `marketOf` REWRITE-RISK** — проследи полное протекание сырого `animals⋈species` в discovery read-model; подтверди, что это истинный prerequisite-блокер для ADR-0014, и точно ограничь refactor route-via-AnimalService.
4. **Security-швы, которые раунд 1 дал MINOR/MAJOR** — атакуй заново, попробуй **эскалировать в CRITICAL** конкретной цепочкой эксплойта: dev-token fail-open на дефолтном NODE_ENV, refresh-rotation TOCTOU, `/metrics @Public`, JWT без algs-pin, animal 403-oracle, avatarUrl stored-XSS, refreshToken-в-body.
5. **Consent / dark-pattern** — дефолт `contact_prefs show_phone:true`; подтверди пробел модели consent-записи (ФЗ-38) и является ли дефолт launch-блокером.
6. **North-star** — раунд 1: ~15% инструментируемо; перепроверь, дёшево ли резервируются `views`/household/unified value-event.
7. **Наши разрешённые конфликты** — переоткрой; сильная модель может не согласиться с адъюдикацией.
8. **P1-зона (contact-channel writer)** — если владелец её ещё НЕ построил, BLOCKER-тест должен остаться RED; если построил — проверь, что фикс честный (реальный register→set-contact→reveail, без фикстуры-маски) и дефолт стал opt-in.

## КАК ГНАТЬ (дисциплина контекста — ОБЯЗАТЕЛЬНО)
- **Каждый агент пишет ПОЛНЫЕ находки + diff-к-раунду-1 в `ZooLink/AUDIT3/<role>.md`, оркестратору — резюме ≤150 слов.** Формат: `[severity][критерий][роль][NEW|CONFIRMED|REFUTED|SEV-CHG] файл:строка → проблема → фикс`. Не выдумывать; неуверен → «требует ручной проверки». Делегаты **не коммитят**.
- **Харнесс-факт:** если сессия запущена НЕ из репозитория ZooLink, 18 проектных ролей не зарегистрированы как subagent-типы — спавни `claude`-агентов, каждый входит в роль, читая `ZooLink/.claude/agents/<role>.md`. Батчи по ~5 (большие фан-ауты ловят rate-limit).

**Фаза 1 — active-user (needs-first):** пройди КАЖДУЮ персону (владелец pet, фермер, заводчик, вет, кинолог, грумер, выгул, передержка, приют, продавец товаров, новичок-покупатель, матёрый продавец), озвучь нужды/трение, ломай/злоупотребляй, вердикт «вернусь ли». → `AUDIT3/active-user.md` + needs-сценарии, сверь с `AUDIT2/active-user.md`.

**Фаза 2 — все спецы параллельно (forward-compat + reconcile):** каждый (a) выводит сам, (b) diff-ит к своему `AUDIT2/<role>.md`, (c) даёт тест-пробы. psychologist в паре ux/ui (доверие/dark-patterns/этика). legal — record-only (ранняя стадия, не блок). architect держит per-seam forward-compat вердикт. → `AUDIT3/<role>.md`.

**Фаза 3 — ГИПЕР-ТЕСТ:** **сначала прогони `backend/test/audit2-*.e2e-spec.ts`** (BLOCKER-RED floor) + полную регрессию (ожидаемо 450/237, Redis flush первым) + реализуй/прогони новые негатив-инварианты на КАЖДУЮ поверхность + расширь `it.todo` наперёд (Offering/booking/reviews, find-nearby, progressive-role, services/find-nearby). Принцип владельца: **«нет теста → не done»**.

**Фаза 4 — синтез + reconcile:** сведи `AUDIT3/*.md` → **`ZooLink/AUDIT3_FORWARD_COMPAT.md`** с обязательной **diff-таблицей раунд1↔раунд2** (NEW/CONFIRMED/REFUTED/SEV-CHG) и объединённым, более достоверным приоритизированным списком. Запиши durable-память. **Коммит — по явной команде владельца.**

Начни с заземления (прочитай `AUDIT2_FORWARD_COMPAT.md` §Attention notes, 2–3 самых острых `AUDIT2/<role>.md`, `zoolink-hypertest-forward-compat-2026-07-02`, `git log --oneline -15`), дай короткий план (кого на что) и запускай Фазу 1.
