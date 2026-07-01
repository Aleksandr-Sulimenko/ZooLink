# 🔥 HYPER-TEST & FORWARD-COMPAT AUDIT — next-session launcher

> **Paste the block below as the first message of a FRESH session** (clean 1M context; the new
> `psychologist` + `active-user` sub-agents are spawnable only from a new session). Enter the
> **zoolink arena**. Everything is on branch `backend`, **not pushed**.

---

СТАРТ! Ты — оркестратор. Заходим в арену **zoolink**. Запусти **ГИПЕР** сквозной анализ + тестирование силами **ВСЕХ 18 спецов** (16 + новые **psychologist** и **active-user**).

## СОСТОЯНИЕ (на 2026-07-01, ветка `backend`, НЕ запушено)
Прошлая сессия: 16-агентный аудит → `ZooLink/AUDIT_2026-06-30.md`; ADR **0014–0019** (0014/0015/0016/0019 **Accepted**, 0017/0018 Proposed) + `docs/04-decisions/ECOSYSTEM_ADR_PLAN.md` (Q1–Q6 ратифицированы); экосистемное видение `docsRU/01-discovery/future-features.md:145-227`. Реализовано: `goods_marketplace` toggle, ADR-0018 route-via-AnimalService, крипто-шов ADR-0019 (email blind-index + contact_phone AES), contact-exchange + mark-sold + analytics. **Тесты: 450 unit / 237 e2e зелёные.** Открытый backlog — в `AUDIT_2026-06-30.md` (§Prioritized + QA-gate forward-plan) и в памяти `zoolink-crossteam-audit-2026-06-30`.

## МИССИЯ (главная линза — FORWARD-COMPAT)
Проверить **соответствие · стопы/блокеры · безопасность · покрытие реальных нужд человека**, и ГЛАВНОЕ — **нет ли решений, принятых СЕЙЧАС, которые в будущем будут препятствовать развитию** (анти-рерайт: схема / контракты / authz / actor-model / `market_scope` / Offering-шов 0014 / monetization / мульти-роль / geo / крипто-шов). **Логика должна прослеживаться сквозь всё** (BR → spec → ADR → schema → code → test). Ранняя стадия ⇒ **скидка: legal только ЗАКЛАДЫВАЕТ находки в память на будущее, не блокирует.**

## КАК ГНАТЬ (дисциплина контекста — ОБЯЗАТЕЛЬНО)
Чтобы не переполнить окно: **каждый агент пишет ПОЛНЫЕ находки в файл `ZooLink/AUDIT2/<role>.md`, а оркестратору возвращает резюме ≤150 слов.** Формат находки: `[severity][критерий][роль] файл:строка → проблема → фикс`. Не выдумывать; неуверен → «требует ручной проверки». Делегаты не коммитят.

**Фаза 1 — active-user ведёт (нужды-first):** подними **active-user** — пройди КАЖДЫЙ флоу как каждая персона (владелец pet, фермер, заводчик, вет, кинолог, грумер, выгул, передержка, приют, продавец товаров, новичок-покупатель, матёрый продавец), озвучь неудовлетворённые нужды/трение, попробуй сломать/зло­употребить, дай вердикт «вернусь ли я». Выход → `AUDIT2/active-user.md` + needs-driven тест-сценарии.

**Фаза 2 — все спецы, параллельно, forward-compat + hyper:** каждый в своей линзе аудитит (a) консистентность, (b) стопы/SPOF, (c) безопасность, (d) **FORWARD-COMPAT — что сейчас заблокирует будущее (анти-рерайт)**, (e) покрытие нужд из Фазы 1. **psychologist** в паре с ux/ui (доверие/когнагрузка/эмоц.путь/этика/анти-dark-patterns). **legal** — record-to-memory на будущее (не блок). architect держит forward-compat-вердикт по швам 0014-0019. Каждый → `AUDIT2/<role>.md` + резюме.

**Фаза 3 — ГИПЕР-ТЕСТ:** reviewer-qa + backend прогоняют needs-driven сценарии active-user + полную регрессию + закрытие дыр покрытия (негатив-инварианты на КАЖДУЮ поверхность, идемпотентность миграций, `migration-drift` CI) + **forward test-plan наперёд** для непостроенного (Offering/booking/reviews B0–B8, services/find-nearby). Принцип владельца: **«нет теста → не done»; все возможные тесты закладывать наперёд.**

**Фаза 4 — синтез:** свести `AUDIT2/*.md` → `ZooLink/AUDIT2_FORWARD_COMPAT.md` (severity-сводка, конфликты мнений, **forward-compat вердикт**, приоритизированный список). Записать durable-память. Коммит — по явной команде владельца (логический сплит).

Начни с заземления (прочитай `AUDIT_2026-06-30.md`, ADR 0014–0019 + ECOSYSTEM_ADR_PLAN, `future-features.md:145-227`, `git log --oneline` сессии), дай короткий план (кого на что) и запускай Фазу 1.
