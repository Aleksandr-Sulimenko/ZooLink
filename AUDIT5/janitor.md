# AUDIT5 — janitor.md (чистота дерева: мусор/дубли/протухшее)

> Роль: janitor. Репо `ZooLink`, ветка `backend`, HEAD `c44874c`. Режим: **propose → confirm →
> execute** — этот отчёт только ПРЕДЛАГАЕТ, ничего не удалено/не перемещено/не закоммичено.
> Снимок `git status` в начале сверен с концом: единственная разница — `AUDIT5/` (параллельные
> агенты этого раунда пишут туда одновременно, включая `backend/test/zz-axis5b-verify.e2e-spec.ts`
> от соседнего лейна) — вне моего лейна, не мусор, не трогал.

## Чего этот свип НЕ увидит (заявляю заранее)

- **Не гонял тесты** (граница задачи) — числа "unit/e2e" ниже беру из последней записи живого
  леджера `ZooLink/CLAUDE.md` (миграция 0040: «701u/e2e 401+9todo»), не из реального прогона.
- **Не читал содержимое AUDIT2/AUDIT3/AUDIT4 построчно** — только целостность перекрёстных ссылок
  (grep по `AUDITn/<role>.md`), не фактическую верность находок.
- **Не проверял `.git` внутренности** (reflog/gc/packfile bloat) — это епархия devops, не janitor.
- **Не сверял EN↔RU расхождения** в протухших доках (это doc-keeper) — только числовую свежесть.
- **Не искал протухшее вне ZooLink** (workspace-root `README.md`/`roadmap.md`/`project_status.md`
  физически лежат ВНЕ репозитория ZooLink — не git-репо, изменения там не отслеживаются git'ом
  ZooLink; включил их в отчёт по прямому пункту задания, но они не входят в git-снимок начала/конца).
- **Секреты/PII** — прогнал только точечный grep по мисплейс-памяти (п.1), не по всему дереву —
  полный секрет-свип всего репо это отдельная (более тяжёлая) задача, не заявленная в задании.

---

## Топ-предложения (сводка)

| # | Что | Доказательство | Предлагаемое действие | Риск |
|---|---|---|---|---|
| 1 | `backend/.claude/agent-memory/{security,legal,finance,growth}/*.md` — 6 уникальных фактов памяти AUDIT4 (08.07), НИКОГДА не смигрированных в канон `agent-os/memory/<role>/` | подтверждено `test -f` × 6 — все MISSING в каноне; ложный cwd — реальные каталоги, не симлинки, в отличие от корня репо | **владельцу/держателям ролей:** смигрировать 6 файлов в `agent-os/memory/<role>/` (с проверкой на пересечение по теме, см. п.1), затем очистить `backend/.claude/` целиком и добавить guard в `.gitignore`/CLAUDE.md против повтора | **высокий, если проигнорировать** — контент нигде больше не существует; низкий сам файл (не в git, копия не потеряется от бездействия) |
| 2 | Workspace-root `roadmap.md`/`project_status.md` — «31 таблица, миграции 0001–0014, 69 unit + 8 e2e», дата 2026-06-19 | реальность (ZooLink/CLAUDE.md, миграция 0040): **41 таблица**, миграции 0001–0040, ledger «701u/401e2e+9todo» — отстаёт на **10 таблиц / 26 миграций / ~6 недель** | владельцу: обновить или явно пометить «архивный снимок Фазы 1» | средний — вне git ZooLink, но это карта, на которую ссылается BOOT/CLAUDE.md workspace |
| 3 | `NEXT_SESSION_HYPER_TEST_PROMPT.md` / `_V2.md` / `_V3.md` — три одноразовых лаунчера раундов 1–3, все отработаны (→AUDIT2/AUDIT3/AUDIT4) | git log показывает каждый закоммичен ИМЕННО как триггер следующего раунда; V3 сам объявляет фикс-программу AUDIT4 закрытой — то есть даже V3 уже отработан | архивировать в `archive/` (по аналогии с workspace-root `archive/`) или `AUDIT_launchers/`, не удалять (git-history не теряется при `git mv`) | низкий — трекано в git, история цела в любом случае |
| 4 | `ADMIN_PHASE_ACTION_PLAN.md` (mtime 25.06, до миграции 0022/34 табл.) и `BACKEND_IMPLEMENTATION_PLAN.md` (mtime 30.06, чеклист замер на Identity Slice-4/137u+29e2e) | grep по номерам миграций/таблиц — оба остановились задолго до текущих 41 табл./0040; `BACKEND_IMPLEMENTATION_PLAN.md` не содержит вообще ни одного домена после Identity | доверить **doc-keeper/architect**: либо пометить заголовком «исторический план Фазы 0–1, закрыт», либо обновить хвост | низкий — читается как живой план, но фактически летопись остановлена → риск бхранти-даршана для нового агента, который доверится числам |
| 5 | `.claude/agent-memory/{bid-writer,estimator,freelance-scout,psychologist}` (симлинки) + `.claude/agents/{bid-writer,estimator,freelance-scout}.md` — untracked, но не мусор | сверил: паттерн идентичен уже затрекованным симлинкам (`alpha-analyst`, `architect`, …); те же цели `../../../agent-os/memory/<role>` | владельцу: `git add` + коммит при следующем осознанном коммите (не моя компетенция — я не коммичу) | нулевой — это просто несделанный `git add`, не cruft |

---

## 1. Untracked `.claude/*` — чьё это и куда девать

### 1a. `.claude/agent-memory/{bid-writer,estimator,freelance-scout,psychologist}` + `.claude/agents/{bid-writer,estimator,freelance-scout}.md`

**Что это.** Симлинки-память и агент-файлы для ролей income-bridge трека (`bid-writer`,
`estimator`, `freelance-scout` — есть в `agent-os/roster/README.md` матрице компетенций) и
`psychologist` (уже частично затрекован — только память-симлинк untracked, сам `.md` уже в git,
но *изменён*, см. §1c).

Проверено на паттерн:
```
.claude/agent-memory/bid-writer -> ../../../agent-os/memory/bid-writer        (символьная ссылка)
.claude/agent-memory/estimator -> ../../../agent-os/memory/estimator          (символьная ссылка)
.claude/agent-memory/freelance-scout -> ../../../agent-os/memory/freelance-scout (симв. ссылка)
.claude/agent-memory/psychologist -> ../../../agent-os/memory/psychologist    (симв. ссылка)
```
Это **байт-в-байт тот же паттерн**, что уже затреканные `alpha-analyst`, `architect`,
`backend-engineer`, `security`, … (`git ls-files .claude/agent-memory/` — 16 записей, все
симлинки того же вида). Это не «чужой трек в продуктовом дереве» — это стандартная проекция
адаптера (`agent-os/adapters/claude-code/sync.sh`), которая, судя по всему, **проецирует ВСЕ
роли ростера в КАЖДЫЙ репозиторий**, включая income-bridge-роли не-ZooLink-домена. Это
архитектурное решение (не моя компетенция менять), просто пока не закоммичено сюда.

**Вердикт:** не мусор. **Предложение:** при следующем осознанном коммите владелец делает
`git add .claude/agent-memory/{bid-writer,estimator,freelance-scout,psychologist} .claude/agents/{bid-writer,estimator,freelance-scout}.md`
(не моя работа — janitor не коммитит).

### 1b. `backend/.claude/` — ⚠ ПОДТВЕРЖДЁННАЯ ЛОВУШКА из якорей

**Что это.** Это **НЕ симлинки** — реальные каталоги с реальными файлами, созданные потому что
какая-то прошлая сессия запускала суб-агентов с `cwd=backend/` вместо корня репо, и харнесс
создал `backend/.claude/agent-memory/<role>/` как обычную папку вместо перехода по симлинку
`.claude/agent-memory/<role>` из корня репо → `agent-os/memory/<role>`.

```
$ ls -la backend/.claude/agent-memory/security/
drwxrwxr-x  2 … security/
-rw-rw-r--  1 … fix-program-verification-audit4.md   (2560 bytes)
-rw-rw-r--  1 … MEMORY.md                              (207 bytes)
```
против канона:
```
$ ls -la agent-os/memory/security/MEMORY.md
lrwxrwxrwx  1 … MEMORY.md -> INDEX.md    (генерируемый индекс, не файл-факт)
```

**Полный список каталогов внутри `backend/.claude/agent-memory/`:** `active-user` (пусто),
`alpha-analyst` (пусто), `architect` (пусто), `backend-engineer` (пусто), `data-analyst` (пусто),
`devops` (пусто), `doc-keeper` (пусто), **`finance`** (3 файла), **`growth`** (2 файла), `janitor`
(пусто), **`legal`** (3 файла), `frontend-engineer` (пусто), `psychologist` (пусто), `reviewer-qa`
(пусто), **`security`** (2 файла), `senior-business-analyst` (пусто), `ui-designer` (пусто),
`ux-designer` (пусто) — 14 пустых + 4 с контентом.

**⚠ Критично: 6 файлов-фактов памяти — уникальны, НИКОГДА не мигрированы в канон.** Проверено
`test -f agent-os/memory/<role>/<file>` для каждого:

| Файл в `backend/.claude/agent-memory/` | В каноне `agent-os/memory/<role>/`? | created | created_by |
|---|---|---|---|
| `security/fix-program-verification-audit4.md` | **MISSING** | 2026-07-08 | security-audit4-phase2 |
| `legal/ai-operator-legal-spine-st16.md` | **MISSING** | 2026-07-08 | legal-audit4 |
| `legal/consent-model-fixed-verified.md` | **MISSING** | 2026-07-08 | legal-audit4 |
| `finance/monetization-soft-start-winwin.md` | **MISSING** | 2026-07-08 | finance-audit4 |
| `finance/reserve-now-seams-finance.md` | **MISSING** | 2026-07-08 | finance-audit4 |
| `growth/funnel-baseline-2026-07.md` | **MISSING** | 2026-07-08 | growth-audit4 |

Все 6 — корректно оформлены (валидный frontmatter `name/description/metadata.type/created_by/
created`), это НЕ мусор по содержанию — это **потерянная память** AUDIT4 (round-3), физически
недостижимая ни через `INDEX.md`, ни через `grep agent-os/memory/`. Дополнительно проверил
широким grep по канону на упоминание этих же slug'ов под другим именем — ноль совпадений
(не переименовали при миграции, просто не мигрировали).

Точечный секрет-грep по этим 6 файлам (`password|secret|api[_-]?key|token|BEGIN (RSA|PRIVATE)|
AKIA…`) — совпадения только на **имена env-переменных** обсуждаемых в тексте (`METRICS_TOKEN`,
`ENABLE_DEV_TOKEN`), не на значения. Секретов/PII не найдено.

**Антарая:** `бхранти-даршана` (замер/действие «доложил, что записал в память» — а фактически
записал в теневую, недостижимую копию; операция выглядела успешной, но мерила не то место) с
корнем `прамада` (небрежность к cwd при запуске суб-агента).

**Предложение (needs-decision, НЕ выполняю сам):**
1. Владельцу/держателям ролей (security, legal ×2, finance ×2, growth) — свериться, не
   перекрывает ли контент уже существующие более свежие факты (бегло проверил: тематически
   близкие файлы в каноне ЕСТЬ — например `legal/zoolink-contact-reveal-live-consent-gap.md`,
   `growth/vk-funnel-north-star-stage0.md` — но **не идентичны по имени/дате**, дедуп нужен
   рукам держателя роли, не мне).
2. После миграции (или явного решения «это устарело, не переносим») — удалить
   `backend/.claude/` целиком (сейчас **не в git**, untracked — удаление ничего не потеряет
   из истории, но контент физически исчезнет без миграции).
3. **Профилактика повтора:** добавить `backend/.claude/` в `.gitignore` ZooLink (сейчас
   отсутствует — только `.env`/`node_modules`/`dist` и т.п. в корневом `.gitignore`; на момент
   свипа `.gitignore` не блокирует `backend/.claude/` вообще, что и позволило ловушке молча
   накопиться повторно с 08.07 по 04.08 без единого предупреждения) + короткая заметка в
   `ZooLink/CLAUDE.md` «суб-агентов всегда запускать из корня репо, не из `backend/`».

### 1c. Модифицированные (не untracked) `.claude/agents/active-user.md`, `.claude/agents/psychologist.md`, `.claude/settings.local.json`

Вне строгого периметра задания (это `M`, не `??`), но раз уже в git status — коротко: диффы
некрупные (+11/-… и +10/-… строк на агентов, +163/-… на settings.local.json). Не мусор, не
дубли — рутинная правка конфигурации/чартеров текущей сессии. Не мой лейн для содержательной
оценки (settings.local.json — это permissions/config, не моя компетенция трогать).

---

## 2. Протухшие лаунчеры — `NEXT_SESSION_HYPER_TEST_PROMPT{,_V2,_V3}.md`

Все три лежат в корне репо, все **закоммичены** (история подтверждает предназначение — каждый
коммит явно называет себя лаунчером СЛЕДУЮЩЕГО раунда):

```
37bbda7  chore(agents): add psychologist + active-user sub-agents + next-session hyper-test prompt   → v1, отработан → AUDIT2/
4533e78  docs(audit): HYPER forward-compat audit (18 lanes) + proof tests + round-2 launcher          → v2, отработан → AUDIT3/
0fcc182  docs(audit): HYPER³ round-3 launcher — re-audit + new axes + trash-test                       → v3, отработан → AUDIT4/
3a60418  docs(audit): HYPER³ round-3 — per-role findings (AUDIT4/×12), hardening synthesis, launcher v3.5
```

`NEXT_SESSION_HYPER_TEST_PROMPT.md` (v1, 28 строк, mtime 01.07) → породил `AUDIT2/`.
`_V2.md` (47 строк, mtime 02.07) → породил `AUDIT3/`.
`_V3.md` (82 строки, mtime 08.07) → породил `AUDIT4/` (сам текст V3 объявляет фикс-программу
по AUDIT4 «ЗАКРЫТА» и ссылается на HEAD `a23a58f`, давно позади текущего `c44874c`).

Все три отработаны и не являются «следующим шагом» ни для чего — этот самый раунд (AUDIT5)
запущен БЕЗ файла `_V4.md` в репозитории (прямым промптом оркестратора), то есть паттерн
«зафиксировать лаунчер в репо» на раунде 4→5 уже прерван владельцем/оркестратором.

**Найдено ещё в AUDIT3/janitor.md (раунд-2, для памяти — не переоткрываю, просто подтверждаю,
что предсказание сбылось):**
```
AUDIT3/janitor.md:140:  hygiene pattern to watch: round 3 → `AUDIT3/`, round 4 → `AUDIT4/`, with no consolidation
```
Ровно это и произошло — уже 4 раунда без консолидации (сейчас 5-й).

**Антарая:** `стьяна` (задача выполнена, действие по уборке за собой не совершено — «объявление
[раунд закрыт] есть, действия [архивации] нет»), с оттенком `анавастхитатва` (достигнутое —
чистый корень — не удержано между раундами).

**Предложение:** переместить (`git mv`, сохраняет историю) все три в `archive/` или новый
`AUDIT_launchers/`; НЕ удалять содержимое — только вынести из корня. Решение и исполнение —
владельцу (я не двигаю файлы).

---

## 3. Аудит-каталоги — целостность перекрёстных ссылок

**Состав:**
- `AUDIT2/` — 19 файлов (18 ролей + `PHASE3_HYPERTEST.md`), даты 02.07.
- `AUDIT3/` — 19 файлов (та же форма), даты 02.07 (вечер/ночь).
- `AUDIT4/` — **12 файлов** (без `PHASE3_HYPERTEST.md`, без `doc-keeper`/`senior-business-analyst`/
  `ui-designer`/`ux-designer`/`frontend-engineer`/`janitor`), даты 08.07. Это НЕ пробел/утеря —
  сам launcher `_V3.md` и память `security/fix-program-verification-audit4.md`
  (`description: "…12 lenses…"` — если сверить с оригинальным набором) явно ограничивают раунд-3
  12-ю линзами намеренно; отдельного `AUDIT4/janitor.md` в этом раунде не заказывали.
- `AUDIT5/` — в процессе (этот отчёт + `_AXIS_ASSIGNMENT.md` от координатора раунда + минимум
  один файл от соседнего лейна, замечен во время свипа).

**Проверка перекрёстных ссылок (`AUDITn/<role>.md`) из сводных отчётов раунда:**
```
AUDIT_2026-06-30.md        → 0 внутренних ссылок формата AUDITn/role.md (раунд-0, до системы AUDIT2+)
AUDIT2_FORWARD_COMPAT.md   → 2 ссылки (active-user.md, reviewer-qa.md) — ОБЕ существуют
AUDIT3_FORWARD_COMPAT.md   → 1 ссылка (architect.md) — существует
AUDIT4_HARDENING.md        → 0 внутренних AUDITn-ссылок в самом файле
```
**Проверка ВСЕХ `AUDITn/*.md`-ссылок по всему трекнутому дереву репо** (`git grep`, 19 попаданий,
источники — 4 ADR EN+RU + 2 спеки + сам `_V3.md`): **0 битых ссылок** — каждая `AUDIT4/<role>.md`,
упомянутая в ADR-0035/0036/0037/0040 и spec-18, физически существует.

**Вердикт: перекрёстные ссылки аудит-раундов ЗДОРОВЫ, осиротевших файлов не найдено.** Единственная
находка — сам факт отсутствия консолидации между раундами (см. §2, антарая `анавастхитатва`) —
не битая ссылка, а архитектурная привычка «раунд закрыт → каталог остаётся навсегда в корне».

---

## 4. Ловушка мисплейс-миграций `workspace/migrations/`

```
$ ls -la /home/asulimenko/Project/workspace/migrations/
ls: cannot access '…/migrations/': No such file or directory
```
**Каталог не существует.** Ловушка из якорей (миграции 0030/0031 когда-то туда попадали) —
**уже устранена** предыдущей уборкой; проверил, что канонические копии на месте:
```
ZooLink/migrations/20260704_0030_notification_in_app_channel.sql   — существует
ZooLink/migrations/20260704_0031_listings_view_count.sql            — существует
```
и что никаких блуждающих `*0030*sql`/`*0031*sql` вне `ZooLink/migrations/` в дереве workspace нет
(`find` по всему workspace, глубина 3, ноль совпадений кроме канона). **Ничего предлагать не
нужно — этот пункт закрыт чисто.**

---

## 5. Свежесть корневых доков — выборка

| Документ | Заявляет | Реальность (CLAUDE.md, миграция 0040) | Отставание |
|---|---|---|---|
| `workspace/roadmap.md:35` | «31 таблица, миграции 0001–0014» | 41 таблица, 0001–0040 | **10 таблиц / 26 миграций** |
| `workspace/roadmap.md:31` | «69 unit + 8 e2e green» | ledger «701u/401e2e+9todo» (последняя запись) | **~630 unit / ~390 e2e** не отражены |
| `workspace/project_status.md:9,15,25` | то же «31 таблица», «69 unit + 8 e2e», дата 2026-06-19 | — | ~6.5 недель |
| `ZooLink/ADMIN_PHASE_ACTION_PLAN.md` (mtime 25.06) | останавливается на миграции 0022 / «34 табл.» (строка B10) | 41 табл., 0040 | **7 таблиц / 18 миграций** |
| `ZooLink/BACKEND_IMPLEMENTATION_PLAN.md` (mtime 30.06) | чеклист Фазы 2 останавливается на Identity Slice-4 («137 unit + 29 e2e») | реализованы Animal/Listings/Moderation/Reputation и т.д. | план не отражает ни одного домена после Identity |

**Оговорка по факту:** `workspace/roadmap.md` и `workspace/project_status.md` физически лежат
ВНЕ `ZooLink/` (в `/home/asulimenko/Project/workspace/`, не git-репозиторий) — формально они вне
периметра «git status ZooLink идентичен», но задание прямо просило их проверить, поэтому включаю
с этой оговоркой; риск для janitor-границ (ничего не менял) нулевой, так как этот путь вообще не
под git.

**Антарая:** `бхранти-даршана` для НОВОГО агента/владельца, который откроет эти файлы и поверит
числам буквально — они «выглядят» как живой статус, но были живым статусом только до 19.06/25.06/
30.06. Корень — `стьяна`: обновление этих конкретных доков прекратилось, хотя `ZooLink/CLAUDE.md`
(живой леджер) продолжает обновляться миграция за миграцией.

**Предложение:** не моя компетенция чинить формулировки/контент (doc-keeper/architect), но
предлагаю janitor-уровневое: либо (а) владелец обновляет числа, либо (б) явный баннер
«📌 архивный снимок на 2026-06-19/25/30, актуальное состояние → `ZooLink/CLAUDE.md`» в шапку
каждого документа — дешёвый способ обезвредить риск, не переписывая план.

---

## 6. Стандартный свип — `.idea/`, `node_modules`, `*.log`, мёртвые симлинки

```
$ git status --ignored --porcelain | grep '^!!'
!! .env
!! .idea/
!! backend/.env
!! backend/coverage/
!! backend/dist/
!! backend/node_modules/
```
Все шесть — **уже покрыты `.gitignore`** (`*.env`/`.idea/`/`dist/`/`coverage/`/`node_modules/`
секции). Ничего вне `.gitignore` не накопилось.

```
$ find . -iname "*.log" -not -path "*/node_modules/*"      → 0 файлов
$ find . -xtype l -not -path "*/node_modules/*"             → 0 битых симлинков
```
Размеры игнорируемых каталогов для контекста (не проблема, просто справка):
`backend/node_modules` 629M · `backend/dist` 3.3M · `backend/coverage` 1.2M · `.idea` 48K —
все стандартные build/tooling-артефакты, корректно исключены из git. Трекнутое дерево репо ≈9.9M.

**Вердикт: чисто.** Ничего предлагать не нужно.

---

## Что НЕ трогал (граница задания подтверждена)

Ничего не удалено, не перемещено, не добавлено в `.gitignore`, не закоммичено. Единственный
записанный файл — этот отчёт (`ZooLink/AUDIT5/janitor.md`). Финальный `git status --porcelain`
идентичен начальному снимку за вычетом `AUDIT5/*` (мой файл + параллельные агенты этого же
раунда, включая `backend/test/zz-axis5b-verify.e2e-spec.ts` от соседнего лейна — не трогал, не
мой файл, не мусор).
