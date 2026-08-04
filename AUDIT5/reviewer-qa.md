# AUDIT5 — reviewer-qa: оси 11 (полнота класса) · 12 (счастливый путь замков) · 13 (адресность)

> Предмет: ZooLink, ветка `backend`, HEAD `c44874c`. Инструмент: `agent-os/design/gate-axes-checklist.md`
> + шесть законов-уроков. Все мутации временные, восстановлены `git checkout`, `git status` чист
> после каждой (проверено 13 раз).

## 0. Стенд — НАЗВАННАЯ НАГРУЗКА (и первое расхождение)

| что | замер |
|---|---|
| СУБД | **PostgreSQL 14.19** (Ubuntu 22.04), а НЕ PG16 |
| Node | v20.20.2, pop-os, host Redis |
| гейт `check-no-raw-market-join.sh` | 0.015 с |
| гейт `check-migration-backfill.sh` | 1.99 с (throwaway DB) |
| гейт drift (локальная реплика job'а `migration-drift`) | 6.9 с, 41 миграция ×2 прохода |
| `test/agent-auth.e2e-spec.ts` | 3.97 с / 15 тестов |

**Р-0 (should-fix · `самшая`).** Лист осей `AUDIT5/_AXIS_ASSIGNMENT.md` объявляет нагрузку базовой
линии как «host PG16/Redis». Замер: `select version()` → `PostgreSQL 14.19`. CI гоняет
`postgres:16-alpine`. То есть «unit 712/712, e2e 405+9» доказаны на **другой мажорной версии**, чем
целевая. Число без верной нагрузки непроверяемо ([[lesson-number-without-samples-unverifiable]]).
Починка: либо поднять dev до 16, либо записать в лист «PG14.19 (CI: 16) — версионно-зависимые
дефекты локальной половиной не ловятся».

## 1. Чего эти три оси НЕ увидят (объявлено ДО первого числа)

1. **Мутации выборочны.** Ось 13 прогнана на **5 свойствах** из **N = 90** тестов шести файлов
   июльской волны (`agent-auth` 15 · `confirmed-sales` 18 · `reputation-storage` 16 ·
   `saved-search-match` 23 · `listing-etag-content-version` 13 · `consent-seq-tiebreak` 5); в e2e
   всего 414 `it()`, в unit — 712. Покрыто мутацией 5/90 = 5,6 % волны, 1,2 % e2e. **Про остальные
   85 свойств волны эта ось не говорит ничего** — ни «работают», ни «декоративны».
2. **Полные своды не перегонялись** (запрет оркестратора). Все выводы «тест X не краснеет» получены
   на **названном подмножестве файлов**, перечисленном в каждой находке. Тест в непрогнанном файле
   мог бы поймать мутацию — где это существенно, сказано явно.
3. **CI-половина.** Гейт drift воспроизведён локально ПОЛНОСТЬЮ (pg_dump 14 против сервера 14), но
   на PG14, а не на PG16 → версионно-зависимый дрейф локальной половиной не пойман.
   Гейт backfill прогнан полностью локально (создаёт свою throwaway БД).
4. **Ось 11(в) 404-no-leak** проверена пробой в живом стенде на ОДНОМ носителе (`animals`), для
   остальных — чтением кода + существующими тестами проекта. Где так — помечено.
5. **Не смотрел вовсе:** производительность гейтов на большом репозитории, поведение под
   параллельным CI, ФЗ-152/юр-контур, UI. Это чужие оси.

---

## 2. ОСЬ 11 — ПОЛНОТА КЛАССА · вердикт **КРАСНЫЙ (4 дыры, из них 1 доказана живой пробой)**

Списки ниже **порождены** (греп/скрипт/`pg_trigger`), не переписаны рукой
([[lesson-handwritten-worklist-loses-items]]). Где порождённый список разошёлся с рукописным
списком в задании — сказано.

### (а) TOCTOU guarded-conditional-write — носителей 14 / покрыто 11 / **дыр 3**

Порождение: скан всех `updateMany|deleteMany|update|delete` в `backend/src` (74 вызова) →
фильтр «есть проверка `.count` в 22 строках после» → **14 носителей класса**.

| # | носитель | loser-тест | чем доказано |
|---|---|---|---|
| 1 | `listing.service.ts:411` edit-ACTIVE→re-enqueue | ✅ | `listing.service.spec.ts:551` mock count 0 |
| 2 | `listing.service.ts:478` submit | ✅ | `listing.service.spec.ts:608` |
| 3 | `listing.service.ts:519` withdraw | ✅ | `listing.service.spec.ts:638` |
| 4 | `listing.service.ts:754` markSold | ✅ | `listing.service.spec.ts:969` |
| 5 | `moderation.service.ts:231` claim | ✅ | `moderation.service.spec.ts:163` + e2e `moderation.e2e:121` (реальная гонка) |
| 6 | `moderation.service.ts:357` action flip | ✅ | `moderation.service.spec.ts:257` и `:273` (две ветви) |
| 7 | `content-report.service.ts:165` resolve | ✅ | `content-report.service.spec.ts:182` |
| 8 | `transfer.service.ts:283` accept | ✅ | `transfer.service.spec.ts:408` |
| 9 | `transfer-expiry.service.ts:113` (планировщик) | ✅ | `transfer-expiry.service.spec.ts:83` |
| 10 | `refresh-token.service.ts:87` CAS | ✅ | `refresh-token.service.spec.ts:96` |
| 11 | `saved-search.service.ts:118` delete | ✅ | `saved-search.e2e:115` (404-no-leak) |
| 12 | **`transfer.service.ts:479` terminate (decline/cancel)** | ❌ **ДЫРА** | мутация ниже |
| 13 | **`transfer.service.ts:522` expireIfDue (ленивая экспирация)** | ❌ **ДЫРА** | мутация ниже |
| 14 | **`moderation-escalation.service.ts:83` SLA-эскалация** | ❌ **ДЫРА** | мутация ниже |

**Р-1 (should-fix · `стьяна` — объявление есть, свидетеля нет) — три замка класса без единого теста.**
Доказано мутацией, а не чтением: три ветви-проигравшего отключены одновременно
(`if (claim.count !== 1 && false)` ×2, `if (claim.count === 1 || true)` ×1) →

```
npx jest src/modules/animal/transfer.service.spec.ts   → 49 passed, 49 total
npx jest --config test/jest-e2e.json --runInBand \
   test/transfer.e2e-spec.ts test/confirmed-sales.e2e-spec.ts \
   test/moderation-escalation.e2e-spec.ts test/outbox.e2e-spec.ts → 58 passed, 58 total
```
**107 тестов зелены при трёх снятых замках.**

Почему «зелено» обманывает у №14: `SLA-1: a second tick … does NOT emit a second event`
(`test/moderation-escalation.e2e-spec.ts:88`) доказывает идемпотентность **предикатом скана**
(`escalated_at IS NULL` в `findOverdue`), а не замком: второй тик до `escalateOne` вообще не
доходит. Замок заведён против ДРУГОГО сценария — экземпляра, проскочившего advisory-lock, — и этот
сценарий не гоняется никем.
Почему у №12: `decline()` вызывает `assertPending(row)` ДО `terminate()`, поэтому тест
`INV-10: decline on an already-CANCELLED transfer → 409` (`transfer.service.spec.ts:547`) падает на
пред-чтении и до `count !== 1` не доходит.

**Расхождение с рукописным списком задания.** Задание называло носителями «settings flip» —
порождённый список его не находит, и правильно: `SystemSettingService.update` →
`FeatureToggleService.flip` делает `upsert({where:{key}})` **без всякого предиката версии** (см. Р-5).
Носителя класса там нет вообще, есть его отсутствие.

### (б) append-only immutability — носителей 5 / покрыто 4 / **дыра 1**

Порождение из живой БД (`pg_trigger ⋈ pg_proc`), не из доков:

| таблица | триггер | негатив UPDATE | негатив DELETE |
|---|---|---|---|
| `moderation_decisions` | `trg_moderation_decisions_immutable` | ✅ `moderation.e2e:287` | ✅ `:288` |
| `consents` | `trg_consents_immutable` | ✅ `consent-seq-tiebreak.e2e:89` | ✅ `:100` |
| `confirmed_sales` | `trg_confirmed_sales_immutable` | ✅ `confirmed-sales.e2e:313` | ✅ `:314` |
| `reviews` | `trg_reviews_immutable` | ✅ `reputation-storage.e2e:91` | ✅ `:92` |
| **`audit_log`** | `trg_audit_log_append_only` | ❌ **НЕТ** | ❌ **НЕТ** |

**Р-2 (should-fix · `стьяна`) — единственный носитель класса без негатив-теста и есть аудит-след.**
Проба на живой БД (`BEGIN … ROLLBACK`) подтверждает, что инвариант СЕГОДНЯ держит:
```
UPDATE audit_log SET action='AUDIT5-probe' … → ERROR: audit_log is append-only
DELETE FROM audit_log …                      → ERROR: audit_log is append-only
```
То есть дефект не «сломано», а «нечем заметить поломку»: снос триггера миграцией или подмена
функции пройдёт весь свод зелёным. Цена ошибки максимальна именно здесь — это неподделываемость
следа актора (ADR-0006).
Побочно: `test/audit2-hypertest.e2e-spec.ts:190` делает
`prisma.audit_log.deleteMany(…).catch(() => undefined)` — уборка, которая ОБЯЗАНА падать, и её
падение проглатывается. Свидетель есть, но он молчит в обе стороны.
Побочно-2 (nit): у класса ДВА разных тела иммутабельности — `audit_log_append_only()` и
`trg_block_modify_append_only()`, хотя миграции 0039/0040 прямо пишут «do NOT invent a 2nd path».
Второй путь — самый старый; сводить в один.

### (в) 404-no-leak object-scope — носителей 10 / без утечки 7 / **утечек 3**

| поверхность | поведение на «есть, но не мой» | тест |
|---|---|---|
| `GET /animals/{id}` | 404 ✅ | `audit2-hypertest.e2e:306` (регрессия на AUDIT2 #5) |
| `GET /listings/{id}` | 404 ✅ | `listing.e2e:186` |
| `GET /listings/{id}/analytics` | 404 ✅ | `listing-contact-sold.e2e:349` |
| `GET /listings/{id}/photos` | 404 ✅ | нет выделенного теста (nit) |
| `GET /content-reports/{id}` | 404 ✅ | `content-report.e2e:145` |
| `DELETE /saved-searches/{id}` | 404, байт-идентичный код ✅ | `saved-search.e2e:115` |
| `DELETE /listings/{id}/favorite` | 204 всегда ✅ | `favorite.e2e:193` |
| **`GET /animals/{id}/ownership-history`** | **403** ❌ | — |
| **`GET /transfers/{transferId}`** | **403** ❌ | тест ЗАКРЕПЛЯЕТ утечку: `transfer.service.spec.ts:555` «a non-party USER → 403» |
| **`GET /listings/{id}/moderation-result`** | **403** ❌ (осознанное отступление) | `moderation.service.ts:515` |

**Р-3 (BLOCKER-кандидат для лейна security · `анавастхитатва` — достигнутое не удержано).**
Лечение существующего класса применили к ОДНОМУ методу ресурса, и класс переехал на соседний.
Проверено **живой пробой** (временный e2e, удалён; `git status` чист):

```
AUDIT5 P-1 {"animals_existing":404,"animals_missing":404,
            "history_existing":403,"history_missing":404}
```
Читается так: `GET /v1/animals/{id}` неотличим (404/404) — починка Wave B2 держит; но
`GET /v1/animals/{id}/ownership-history` для ТОГО ЖЕ id даёт **403 на существующем и 404 на
несуществующем** → оракул существования, который AUDIT2 #5 закрывал, полностью доступен через
дочерний ресурс того же объекта. Ровно
[[lesson-cure-must-be-tested-against-its-own-class]]: приёмка починки не гоняла класс по всем
носителям, поэтому «AUDIT2 #5 FIXED» — правда про метод и неправда про ресурс.

Тот же класс, проверено чтением (не пробой): `GET /v1/transfers/{id}` (`loadOrThrow` → 404,
`assertCanView` → 403); `GET /v1/listings/{id}/moderation-result` — комментарий на
`moderation.service.ts:516` оправдывает 403 тем, что «listing existence is already known to the
caller», но для DRAFT-объявления это неверно: `listing.e2e:186` доказывает, что `GET /listings/{id}`
на чужом DRAFT даёт 404. Посылка отступления ложна ровно в том состоянии, где утечка что-то стоит.
Как проверить за одну пробу: чужой DRAFT → `GET /v1/listings/{draft}` = 404, а
`GET /v1/listings/{draft}/moderation-result` = 403 ⇒ оракул.
Дополнительно: у `PATCH /animals/{id}`, `/deactivate`, `/reactivate`, `PATCH /listings/{id}`
пред-чтение 404 + `assertCanMutate` 403 — та же различимость на мутирующих путях
(политический вопрос, не обязательно дефект; в решение архитектора).

### (г) ETag/If-Match — 428/412 покрыты 6 из 6, **но обещание §10 не покрыто ни одним**

Порождённый список `@Patch`: **10 обработчиков**, из них If-Match читают **6** — и у всех шести
есть и 428, и 412 (`animal.e2e:249/256` · `identity.e2e:198/204` · `listing.e2e:202/203` ·
`content-report.e2e:186/187` · `admin-reference-data.e2e:188/195` · `admin-system-settings.e2e:154/163`).
**Дыр по 428/412 нет.** Четыре PATCH без If-Match (`animals/{id}/deactivate`, `/reactivate`,
`admin/users/{id}/role`, `reference-data/{ds}/{id}/toggle-active`) формально попадают в оговорку §10
«state-transition endpoints keep their guard-based 409» — но оговорка не перечислима, и
`toggle-active` при этом обходит If-Match на ТОМ ЖЕ ресурсе, у которого `PATCH /:id` его требует
(nit, но это [[lesson-vague-criterion-hides-its-own-defect]] в чистом виде: критерий без списка).

**Р-4 (should-fix · `бхранти-даршана`) — ось меряет заголовок, а не свойство.**
`API_CONVENTIONS §10` дословно обещает: *«This prevents silent last-write-wins when two owners/
moderators edit the same listing/animal/org concurrently»*. Тесты 428/412 проверяют **наличие и
свежесть заголовка**, но не обещанное свойство. Живая проба:

```
AUDIT5 P-3 {"statusA":200,"statusB":200,"finalName":"WriterB"}
```
Два одновременных `PATCH /v1/me` с **одним и тем же** If-Match → **оба 200**, запись WriterA
потеряна молча. Механика: `assertIfMatch` читает строку, а запись идёт `update({where:{id}})` —
проверка и действие разнесены, предиката версии в записи нет.

**Р-5 (should-fix · тот же корень).** Носители той же формы (чтение → `assertIfMatch` → запись без
предиката версии): `profile.service.ts:44` (доказано пробой) · `animal.service.ts:200` ·
`reference-data.service.ts:286` · `system-setting.service.ts:93` → `feature-toggle.service.ts:72`
`upsert({where:{key}})` · `listing.service.ts:327` → `editDraft` (`update({where:{id}})`).
Итого **5 незащищённых из 11** If-Match-носителей. Остальные 6 (submit / mark-sold / ACTIVE-edit /
content-report resolve / transfer accept·decline·cancel) защищены **побочно** — их `updateMany`
сторожит `status`, который в этих переходах меняется; при редактировании «в том же состоянии»
такой защиты нет по построению.
Показательно, что тест на реальную гонку («two parallel … same ETag») существует ровно у
защищённых носителей (`content-report.e2e:196`, `listing.e2e:244`/`:556`, `transfer.e2e:234`,
`confirmed-sales.e2e:191`) и отсутствует у всех пяти незащищённых. Класс прогнан только там, где
он проходит.

---

## 3. ОСЬ 12 — СЧАСТЛИВЫЙ ПУТЬ ЗАМКОВ · вердикт **ЖЁЛТЫЙ (3/3 пропускают годное; 2 из 3 не краснеют от части своего предмета)**

Для каждого гейта: (i) зелёный на годном — прогнан заново, не взят из базовой линии;
(ii) красный от СВОЕЙ мутации; (iii) мутация по тому же СВОЙСТВУ, но в другой форме.

### Гейт 1 — `scripts/check-no-raw-market-join.sh`
- (i) зелёный на HEAD, 0.015 с, честно печатает единственное размеченное исключение
  (`moderation.service.ts:194`).
- (ii) **краснеет.** `backend/src/tmp-audit5-mutation.ts` с
  `SELECT s.market FROM animals a JOIN species s …` → `exit 1`, сообщение адресное, называет файл и строку.
- (iii) **не краснеет на трёх формах того же свойства** (файл удалён, `git status` чист):

| мутация (то же свойство: market выводится вне animal-агрегата) | гейт |
|---|---|
| M1b `select s.market from animals a join species s …` (нижний регистр) | 🟢 пропустил |
| M1c обход связи Prisma `listings → animals → species.market` (SQL-литерала нет) | 🟢 пропустил |
| M1d `FROM` и `animals` на разных строках | 🟢 пропустил |

**Р-6 (should-fix · `бхранти-даршана`).** Гейт объявляет предметом «no read-path outside the animal
aggregate may re-derive the market», а меряет **текстовый литерал в верхнем регистре на одной
строке**. M1c не гипотетичен: это ровно тот идиом, которым пользуется сам проект (комментарий гейта
про «nested species select» у `AnimalService`, а `ZooLink/CLAUDE.md` про миграцию 0037 прямо пишет
«reworded docstring avoids `FROM animals`/`JOIN species` grep-gate false-positive»). Значит для
Prisma-пути гейт регулирует **формулировку комментариев**, а не поведение.
Починка: добавить регистронезависимость (`grep -riE`) + отдельную ось на Prisma-обход
(`select:.*species.*market` вне `modules/animal`), либо честно сузить объявление гейта до
«raw SQL only» — тогда объявление перестанет обещать больше, чем меряет.

### Гейт 2 — `scripts/check-migration-backfill.sh`
- (i) зелёный, 1.99 с, throwaway БД, свою же БД сносит.
- (ii) **краснеет по первому предмету** («backfill даёт верное ЗНАЧЕНИЕ»): в 0033
  `SET market = s.market` → `SET market = 'pet'` ⇒
  `ERROR: P2-3 FAIL (0033): backfill expected market=livestock, got pet`, exit ≠ 0. Адресно.
- (iii) **НЕ краснеет по второму предмету** («второй проход доказывает идемпотентность на
  ЗАПОЛНЕННЫХ данных»): убран сторож `AND l.market IS NULL` ⇒ повторный прогон затирает
  существующие значения ⇒ гейт **exit 0, зелёный**.

**Р-7 (should-fix · `бхранти-даршана`).** Причина точная: посев гейта содержит только строку,
которую backfill пересчитает **в то же самое значение**, поэтому затирание неотличимо от
no-op. Чтобы ось ловила свой предмет, посев обязан содержать строку с **расходящимся** значением
(например `listings.market='pet'` при `species.market='livestock'` — «уже поправлено приложением»),
и после второго прохода гейт должен требовать, что значение НЕ изменилось.

**Р-8 (should-fix · `аласья` — счёт вместо имён / рукописный охват).** Гейт объявляет «For each
backfill migration», а перечисляет 0033/0032/0036 рукой. Порождённый скан (`^UPDATE <tbl> SET` вне
тел функций) даёт **пять настоящих SQL-backfill'ов**, из них **два вне гейта**:
- `migrations/20260708_0035_listings_content_version.sql:60`
  `UPDATE listings SET content_updated_at = updated_at;` — и это худший случай: его собственная
  шапка (строки 45–49) объявляет ДВА негативных инварианта («re-run is a no-op… values are NOT reset»
  и «N-1 INSERT без колонки проходит через DEFAULT»), у которых нет исполняемого свидетеля нигде;
  ровно тот дефект, который М2b показал как слепое пятно гейта;
- `migrations/20260617_0007_species_market.sql:12` `UPDATE species SET market='livestock' …`.
Оговорка честности про мой счётчик: мой скан **не видит** 0036 (там backfill неявный, через
`GENERATED ALWAYS AS IDENTITY`), то есть занижает; поэтому «пять» — нижняя граница, а вывод
«охват перечислён рукой и потому неполон» от этого только крепче.

### Гейт 3 — drift (`.github/workflows/ci.yml`, job `migration-drift`)
- (i) зелёный локально: 41 миграция ×2 прохода + `pg_dump` diff = **GREEN, 6.9 с** (PG14.19).
- (ii) краснеет от мутации «миграция создаёт DDL, которого нет в каноне»:
  `ALTER TABLE reviews ADD COLUMN … audit5_drift_probe TEXT` в 0040 ⇒
  `GATE_RESULT=RED`, diff показывает `+    audit5_drift_probe text,`.
- (iii) **НЕ краснеет от зеркальной мутации**: `ALTER TABLE audit_log ADD COLUMN …
  audit5_drift_probe TEXT` в `database_schema.sql` (канон содержит DDL, которого не делает ни одна
  миграция) ⇒ **GREEN**.

**Р-9 (BLOCKER для доверия к гейту · `бхранти-даршана` + класс «эталон в досягаемости
наблюдаемого»).** Причина структурная: обе «дорожки» стартуют с ОДНОГО И ТОГО ЖЕ
`database_schema.sql` (шаг «Path 2 — canonical schema + replay migrations»). Любое изменение
канона попадает в ОБЕ стороны diff'а и вычитается. Гейт объявляет «both bootstrap paths must be
identical» и «reconcile database_schema.sql with migrations», а меряет **одно направление из двух**:
ловит только то, что миграции ДОБАВЛЯЮТ сверх канона. Следствие в бою: миграции **никогда не
доказываются как самостоятельный путь с нуля** — если завтра из миграций выпадет то, что есть
только в каноне, свод останется зелёным. Это тот самый класс из
[[lesson-cure-must-be-tested-against-its-own-class]] («эталон, до которого достаёт наблюдаемый, —
не эталон»).
Починка (дешёвая, без новых зависимостей): Path 2 = **пустая БД + только `migrations/*.sql`**,
Path 1 = `database_schema.sql`. Тогда diff двусторонний по построению.
Смягчающее: сегодня канон и миграции сходятся (замерено), так что это дыра наблюдения, а не
активная поломка.

---

## 4. ОСЬ 13 — АДРЕСНОСТЬ · вердикт **ЖЁЛТЫЙ (3 адресны, 1 шумит, 1 декоративна)**

Формат: СВОЙСТВО словами оси → адресная мутация продуктового кода → прогон ТОЛЬКО целевого файла
через `flock /tmp/zoolink-jest.lock` → что упало.

### T1 · agent-auth parity-DoD — **АДРЕСНА** ✅
Свойство: *«для AGENT-принципала эффективная способность = matrix(role) ∩ scope, deny-by-default;
`manage:all` для AGENT не эмитится никогда; путь HUMAN байт-идентичен»*.
Мутация: `ability.factory.ts:55` `if (principal.principalType !== 'AGENT') return matrix;` → `return matrix;`.
- `test/agent-auth.e2e-spec.ts` → **1 failed / 15**: `a deny-by-default agent (no profile) …
  denied the scoped operation (403 through PoliciesGuard)` (`:229`, ассерт `:240`).
- `src/lib/auth/ability.factory.agent-scope.spec.ts` → **11 failed / 29**, и все 11 — AGENT-ветви
  (`AGENT with undefined scope can do nothing` ×7, empty scope, «strictly narrower», «never the
  wildcard», «manage/all is dropped»). **Все 8 HUMAN-паритетных тестов остались зелёными** — то есть
  ось не только краснеет от своей мутации, но и не краснеет от чужого.
Нит: e2e-слой держит это свойство ОДНИМ тестом; вся доказательная масса в unit.

### T2 · пин `ISSUANCE_HUMAN_ONLY` — **АДРЕСНА** ✅
Свойство: *«выпуск/ротация/отзыв учётки агента — HUMAN-only, даже у AGENT с role='ADMIN'»*.
Мутация: `agent-credential.service.ts:199` `if (actor.principalType !== 'HUMAN')` → `if (false)`.
`test/agent-auth.e2e-spec.ts` → **1 failed / 15**, ровно `an AGENT-ADMIN principal cannot issue /
rotate / revoke (403 HUMAN-only)` (`:151`). Идеальная адресность: одна мутация — один тест.

### T3 · `confirmed_sales UNIQUE(ownership_transfer_id)` exactly-once — **ШУМИТ, но слой доказан** ⚠️
Свойство: *«ровно одна строка confirmed_sales на один transfer — под редоставкой и параллельным accept»*.
- Мутация A (`ownership_transfer_id: row.id` → `null`, т.е. backstop перестаёт связывать) →
  `test/confirmed-sales.e2e-spec.ts` **9 failed / 18**. Красное, но не адресное: тесты ищут строку
  ПО `ownership_transfer_id`, поэтому падает и то, что к exactly-once отношения не имеет.
- Мутация B, точная (`transfer.service.ts:293`, замок единственного победителя в `accept` снят,
  UNIQUE оставлен) → `test/confirmed-sales.e2e-spec.ts` **18 passed / 18**, включая
  `re-accepting … does NOT create a second confirmed_sales row` и `two parallel accepts … exactly one
  confirmed_sales row`.
**Вывод — хороший**: инвариант продажи держится БЕЗ прикладного замка, одной БД-уникальностью; это
настоящая эшелонированная защита, а не декларация. **Вывод — плохой**: `test/transfer.e2e-spec.ts`
при снятом замке даёт **30 passed / 30**, а единственный свидетель замка во всём своде — один
мок-юнит `transfer.service.spec.ts:408` (**1 failed / 49**). Реальной гонки accept не гоняет никто.

### T4 · `uq_reviews_current_per_direction` (partial-unique head) — **ДЕКОРАТИВНА относительно артефакта** ❌
Свойство: *«схема репозитория обеспечивает не более одной ТЕКУЩЕЙ рецензии на (sale, direction)»*.
Мутация: индекс удалён **и из `database_schema.sql:737`, и из
`migrations/…0040…sql:138`** — то есть из обоих артефактов, которые и есть предмет ревью.
- `test/reputation-storage.e2e-spec.ts` → **16 passed / 16** 🟢
- локальный drift-гейт → **GREEN** 🟢

**Р-10 (BLOCKER-кандидат · `бхранти-даршана`).** Ось объявляет предметом инвариант СХЕМЫ, а меряет
**живую dev-БД**, в которой индекс уже есть. Из репозитория инвариант можно вынести целиком — и
ни свод, ни гейт этого не заметят; заметит только среда, поднятая с нуля (то есть прод). Это
относится не к одному тесту, а ко ВСЕМУ классу БД-инвариантных e2e (append-only ×5, все именованные
CHECK, UNIQUE, GENERATED — по грубой оценке ≈ 40 ассертов в `reputation-storage` +
`confirmed-sales` + `consent-seq-tiebreak` + `moderation.e2e`).
Компенсирующий контроль (drift-гейт) от этого класса **не спасает**: он двусторонен лишь наполовину
(Р-9), и в данном случае мутация симметрична — из канона и из миграции сразу — что он не видит
по построению.
Починка: e2e БД-инвариантов должны подниматься на БД, собранной из артефактов (`database_schema.sql`
в throwaway-схему), а не на dev-БД; либо гейт drift переделать на «пустая БД + только миграции» и
дополнить проверкой присутствия именованных ограничений по списку.

### T5 · H4 дедуп `idempotency_key` — **ДЕКОРАТИВНА, доказано двумя мутациями** ❌
Свойство: *«редоставка `Listing.Activated` даёт ровно ОДНУ строку на пару (saved_search, listing)»*.
- Мутация T5a (ключ `…:${Date.now()}${Math.random()}` — недетерминированный):
  `test/saved-search-match.e2e-spec.ts` **13 failed / 23**; целевой H4-3 упал, но с
  `Expected: 1, Received: 0` — то есть «строка пропала», а не «строк стало больше». Ещё 12 падений —
  сцепка тестов с литералом ключа (хелперы `rowFor`/`countFor` ищут ПО ключу).
- Мутация T5b, точная по свойству (ключ канонический на первой доставке и случайный на повторных —
  ровно поведение реального бага в построении ключа): **H4-3 ЗЕЛЁНЫЙ** при физически записанных
  дубликатах. Образцы из прогона:
  ```
  AUDIT5-T5b-WROTE saved_search_matched:fe820542…:39192537…:dup5 0.389…
  AUDIT5-T5b-WROTE saved_search_matched:fe820542…:39192537…:dup5 0.396…
  ```
  (та же пара search×listing, две лишние строки — и тест «exactly one row per pair» проходит).

**Р-11 (should-fix · `бхранти-даршана`).** Причина арифметическая, её видно на бумаге:
`countFor` = `count WHERE idempotency_key = '<канонический литерал>'`, а на колонке висит
`uq_notification_idempotency UNIQUE(idempotency_key)` ⇒ результат ∈ {0, 1} **по построению**.
Ассерт `toBe(1)` физически не способен увидеть дубликат — он умеет ловить только отсутствие.
Ровно [[lesson-vague-criterion-hides-its-own-defect]]: подставь мутацию в КРИТЕРИЙ и посчитай.
Правильный критерий: `count WHERE user_id = <owner> AND template = saved_search_matched AND content
LIKE …` (или по `template_id` + `user_id` + окно) — величина, которая может быть 2.
Отдельно: T5b всё-таки был пойман — тестом **H4-17** (`exactly one SavedSearch.Matched event`),
то есть «свод покраснел» ≠ «ось работает» ([[lesson-axis-must-catch-its-own-mutation]]).
И это тонко: H4-17 **не существовал до HEAD** — проверено
`git show c44874c^:backend/test/saved-search-match.e2e-spec.ts | grep -c H4-17` → **0**. До
последнего коммита дубликаты уведомлений не видел никто.

---

## 5. Сводка находок

| # | severity | антарая | предмет | file:line |
|---|---|---|---|---|
| Р-9 | **blocker** | бхранти-даршана | drift-гейт односторонний: обе дорожки стартуют с `database_schema.sql`, канон-only DDL невидим | `.github/workflows/ci.yml` job `migration-drift`, шаг «Path 2» |
| Р-10 | **blocker** | бхранти-даршана | БД-инвариантные e2e меряют dev-БД, а не артефакты: индекс снесён из схемы И миграции → 16/16 зелено + drift GREEN | `test/reputation-storage.e2e-spec.ts:95`, `database_schema.sql:737` |
| Р-3 | **blocker** (security) | анавастхитатва | оракул существования, закрытый на `GET /animals/{id}`, жив на дочернем `…/ownership-history` (403 vs 404) — доказано пробой | `transfer.service.ts:619`, controller `:142` |
| Р-4 | should-fix | бхранти-даршана | If-Match не выполняет обещание §10: два PATCH с одним ETag → оба 200, запись потеряна | `profile.service.ts:44`, `API_CONVENTIONS §10` |
| Р-5 | should-fix | бхранти-даршана | 5 из 11 If-Match-носителей пишут без предиката версии; гоночный тест есть только у защищённых | `animal.service.ts:200` · `reference-data.service.ts:286` · `system-setting.service.ts:93` · `listing.service.ts:327` |
| Р-1 | should-fix | стьяна | 3 замка TOCTOU без единого теста (107 тестов зелены при снятых замках) | `transfer.service.ts:479`, `:522`, `moderation-escalation.service.ts:83` |
| Р-2 | should-fix | стьяна | `audit_log` — единственный append-only носитель без негатив-теста UPDATE/DELETE | `database_schema.sql:1469` |
| Р-11 | should-fix | бхранти-даршана | H4-3 не может увидеть дубликат: считает по UNIQUE-ключу (∈{0,1}); дубликаты ловит соседний H4-17, появившийся только в HEAD | `test/saved-search-match.e2e-spec.ts:139`, `:228` |
| Р-6 | should-fix | бхранти-даршана | market-гейт слеп к нижнему регистру, к Prisma-обходу и к переносу строки | `scripts/check-no-raw-market-join.sh:36` |
| Р-7 | should-fix | бхранти-даршана | backfill-гейт не краснеет от снятия сторожа идемпотентности (посев без расходящейся строки) | `scripts/check-migration-backfill.sh` (посев 0033) |
| Р-8 | should-fix | аласья | охват backfill-гейта перечислен рукой; вне гейта ≥2 настоящих backfill'а, у 0035 два объявленных инварианта без свидетеля | `migrations/…0035…sql:45-60`, `…0007…sql:12` |
| Р-0 | should-fix | самшая | лист осей объявляет PG16, стенд — PG14.19 | `AUDIT5/_AXIS_ASSIGNMENT.md` |
| нит | — | — | два разных тела append-only вопреки «do NOT invent a 2nd path»; `toggle-active` обходит If-Match того же ресурса; `audit_log.deleteMany().catch()` глушит обязанное падение | `database_schema.sql:1465` · `reference-data.controller.ts:118` · `audit2-hypertest.e2e-spec.ts:190` |

**Правило остановки** ([[gate-axes-checklist]] §Как применять п.4): блокируют только **тихий отказ**
и **вред, видимый владельцу**. Р-9/Р-10/Р-3 — тихие отказы (инвариант уезжает молча, существование
утекает молча). Остальное — открытый именованный список.

## 6. Вердикты осей

| ось | вердикт | одной строкой |
|---|---|---|
| **11 полнота класса** | 🔴 КРАСНЫЙ | (а) 14/11/3 · (б) 5/4/1 · (в) 10/7/3 · (г) 6/6/0 по 428-412, но 5/11 носителей без версионной записи |
| **12 счастливый путь** | 🟡 ЖЁЛТЫЙ | все три гейта пропускают годное и краснеют от «своей» мутации в канонической форме; два из трёх слепы к части собственного предмета (Р-6, Р-7, Р-9) |
| **13 адресность** | 🟡 ЖЁЛТЫЙ | 3 адресны (T1, T2, T3-B) · 1 шумит (T3-A) · 1 декоративна по предмету (T4) · 1 декоративна арифметически (T5/H4-3) |

_Все прогоны — под `flock /tmp/zoolink-jest.lock`, `--runInBand`. Redis не флашился. psql-пробы —
`BEGIN … ROLLBACK`; DDL-мутации — только на throwaway-БД (`audit5_canonical`/`audit5_migrated`,
снесены). Рабочее дерево после каждой мутации восстановлено `git checkout`, финальный `git status`
не содержит ни одного изменённого файла репозитория._
