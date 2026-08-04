# AUDIT5 — devops: ось 9 ОБРАТИМОСТЬ · ось 10 СОВМЕСТИМОСТЬ

> Предмет: ZooLink, ветка `backend`, HEAD `c44874c`, миграции 0001–0040, 41 таблица.
> Исполнитель: devops. Дата прогона: 2026-08-04.
> Закон лейна: **непроверенный откат = гипотеза отката.** Каждая проба ниже — ИСПОЛНЕНА,
> с образцом SQL/командой и её фактическим выводом. Ни одна строка не написана «по коду, должно работать».

## Стенд (названная нагрузка — иначе число не факт)

| что | значение |
|---|---|
| эфемерный PG | `docker run postgres:16-alpine` → **PostgreSQL 16.14** (musl/alpine), порт хоста 55433, контейнер `zoolink-audit5-pg` **удалён за собой** (`docker ps -a --filter name=zoolink-audit5` → 0) |
| живой dev-PG | **НЕ трогался вообще** — ни read-only, ни BEGIN/ROLLBACK; весь лейн уехал на эфемерный |
| базы прогона | `audit5_full` (fresh: schema+seed) · `audit5_replay` (schema+replay×2) · `audit5_ci` (CI-образный) · `audit5_atomic`/`audit5_atomic2` (атомарность) |
| хост | pop-os, node v20.20.2, docker; замеры однопользовательские, без конкурентной нагрузки |
| продуктовый код/схема | **не изменялись**; `prisma db pull` гонялся только на КОПИИ схемы в скретчпаде, `git status backend/prisma` пуст |

## Чего эти две оси НЕ увидят (объявлено ДО первого числа)

1. **Реального прод-отката с трафиком нет.** Нет прод-инсталляции, нет живых пользователей,
   нет параллельно работающих N и N-1 подов. Всё ниже — симуляция N-1-кода **живым SQL** на
   схеме N, а не наблюдение настоящего rolling deploy.
2. **Не измерено время простоя при откате.** Восстановление из `pg_dump` не прогонялось на
   объёме прод-базы (её нет); RPO/RTO остаются расчётными.
3. **Кросс-инстансная сходимость feature-toggle не замерена секундомером** — в стенде один
   процесс API. Граница 30 с взята из кода и НЕ подтверждена прогоном (см. Ф-7).
4. **Откат объектного хранилища (MinIO) и Redis** вне лейна — смотрелась только БД и деплой-путь.
5. **Не проверялась миграция «вперёд с потерей»** — что происходит, если 0035–0040 применить на
   базе, где уже есть данные, созданные N+1 кодом. Такого кода нет.
6. **Постороннее в дереве:** во время прогона другой лейн AUDIT5 держал в рабочем дереве
   намеренную мутацию `backend/src/lib/auth/ability.factory.ts` (ось 13). Мои пробы — SQL/схемные;
   единственный запуск e2e прогонялся **с этой мутацией в обоих плечах** (и в красном, и в
   контрольном), поэтому сравнение корректно: единственной переменной была БАЗА.

---

## ВЕРДИКТЫ

| ось | вердикт | одной строкой |
|---|---|---|
| **9 · ОБРАТИМОСТЬ** | 🔴 **NO-GO** | Совместимость «вперёд» последних миграций **доказана прогоном** (0035/0036/0038/0039/0040 — N-1-безопасны), но **сам откат для MVP не определён**: down-миграций 0, раздел отката в MVP-ранбуке отсутствует, а тот, что есть в `deployment.md`, — из Target-документа про Kubernetes; применение миграций **не атомарно** и **не журналируется**; откат feature-toggle **не мгновенен**. |
| **10 · СОВМЕСТИМОСТЬ** | 🔴 **NO-GO** | Старые ДАННЫЕ несёт корректно (refresh-токены до-0020, favorites до-0032, listings до-0033, consents — все зелёные исполненной пробой). Красное — не данные, а **пути установки**: свежая инсталляция молча теряет справочные данные 0037 (доказано падением 13 из 23 e2e), companion-бэкфилл 0028 — сирота, а `schema.prisma` не совпадает **ни с одним** из двух путей бутстрапа. |

**Блокеры (по правилу остановки — тихий отказ и вред, видимый владельцу):** Ф-1, Ф-8.
**Красное, но громкое (не блокер, чинить до релиза):** Ф-2, Ф-3, Ф-4, Ф-5.
**Хвосты:** Ф-6, Ф-7, Ф-9, Ф-10.

---

# ОСЬ 9 — ОБРАТИМОСТЬ

## (а) Полная схема + сид на эфемерном PG16 — ✅ ЗЕЛЁНО

```
$ psql -h localhost -p 55433 -U zoolink -d audit5_full -f database_schema.sql
real 0m1.030s   exit=0
$ ... -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
    41
$ DATABASE_URL=postgresql://…:55433/audit5_full npm run seed     # прогон 1
$ DATABASE_URL=postgresql://…:55433/audit5_full npm run seed     # прогон 2
Seed counts:  supported_languages 5 · species 5 · breeds 4 · cities 2 · feature_toggles 14
              moderation_reasons 9 · notification_templates 22 · decision_templates 3
```
Оба прогона — **идентичные счётчики**, ошибок нет: сид идемпотентен. 41 таблица на месте.

Реплей-путь тоже зелёный и **дёшев**, с названной нагрузкой:

| путь | нагрузка | время |
|---|---|---|
| `database_schema.sql` (fresh) | пустая БД | **1,03 с** |
| реплей всех 40 миграций, проход 1 | пустая БД | **2,13 с** |
| реплей всех 40 миграций, проход 2 (идемпотентность) | пустая БД | **2,16 с** |
| реплей всех 40 миграций, первый на данных | 60 000 строк | **5,04 с** |
| реплей всех 40 миграций, установившийся | **120 000 строк / 70 МБ** (users/animals/listings по 20k, consents 40k, favorites 20k) | **2,84 с** |

Это важное **положительное** число: «переиграть всё с нуля» — операция на секунды, а не на часы.
Она и есть фактическое средство восстановления после сбоя применения (см. Ф-6).

## (б) Симуляция N-1 для 0035–0040 — ✅ все SAFE, доказано исполнением

Старый код не знает новых колонок. Пробы — от его имени, живым SQL на схеме N.

**P1 (0035) — INSERT листинга БЕЗ `content_updated_at`:**
```sql
INSERT INTO listings (id, animal_id, seller_id, listing_type, market) VALUES (…,'sale','pet');
SELECT content_updated_at IS NOT NULL AS p1_content_updated_at_defaulted FROM listings WHERE id=…;
```
```
 p1_content_updated_at_defaulted
---------------------------------
 t
```
`DEFAULT now()` отработал → **SAFE**, как и обещает шапка миграции.

**P1b (регрессия 0033, контроль) — INSERT листинга БЕЗ `market`:**
```
ERROR:  null value in column "market" of relation "listings" violates not-null constraint
```
Классификация ранбука «0033 = UNSAFE, stop-the-world» **воспроизведена на HEAD**, не устарела.

**P2a (0036) — INSERT в `consents` БЕЗ `seq`:**
```
                  id                  | seq
--------------------------------------+-----
 81921d77-5165-4dba-a8ef-c0193a55690d |   1
```
БД сама выдала `seq` → **SAFE**.
**P2b (адресный контроль)** — код, который ПЫТАЕТСЯ писать `seq`:
```
ERROR:  cannot insert a non-DEFAULT value into column "seq"
DETAIL:  Column "seq" is an identity column defined as GENERATED ALWAYS.
```
То есть проба различает два случая, а не «всё проходит».

**P3 (0040 §C) — старое значение `consent_type` после расширения CHECK:**
`INSERT … 'CONTACT_DISTRIBUTION'` → `seq = 2`, принято → расширение CHECK **N-1-безопасно**.

**P4 (0038) — INSERT `service_credentials` ТОЛЬКО с до-0038 колонками:**
```
                  id                  | issued_by | expires_at | capability_profile_id
--------------------------------------+-----------+------------+-----------------------
 00000000-0000-0000-0000-00000000ad01 |           |            |
```
Все три новые колонки nullable → **SAFE**.

**P5 — `SELECT *` старого кода на выросших таблицах:** отрабатывает, лишние колонки безвредны
(`SELECT count(*) FROM (SELECT * FROM listings) t` / `… consents` — без ошибок).

**0039/0040 — новые таблицы:** старый код их не касается; ALTER на СУЩЕСТВУЮЩИХ таблицах в них
только один — расширение CHECK в 0040 (проба P3). Триггеров на старые таблицы не добавлено.

> 🔎 **Ф-9 (P3).** Таблица классификации N-1 в
> `docs/06-operations/runbooks/migration-deploy-order.md` **обрывается на 0036** — 0037–0040 в ней
> нет, хотя ранбук требует `-- N-1:` строку в шапке каждой новой миграции (у 0037 её и правда нет;
> у 0038/0039/0040 есть в прозе). Пробы выше закрывают дыру фактом: **0037 SAFE (только данные),
> 0038 SAFE, 0039 SAFE, 0040 SAFE.** Антарая: `анавастхитатва` (правило нарушено на следующей же
> миграции после того, как записано). Файл: `docs/06-operations/runbooks/migration-deploy-order.md`
> строки 55–70; `migrations/20260708_0037_saved_search_matched_notification.sql`.

### 🔴 Ф-4 (P1, латентно) — `ON DELETE SET NULL`/`CASCADE` на append-only таблицах не может исполниться

Миграция 0040 объявляет дословно: «party FKs `reviewer_user_id`/`subject_user_id` **ON DELETE SET
NULL (ФЗ-152 pseudonymise, fork 8)**». 0039 объявляет то же для `confirmed_sales`. Механизм
**структурно неисполним**: SET NULL — это UPDATE по строке, а строку сторожит
`trg_block_modify_append_only`.

```sql
BEGIN;
… INSERT users(seller,buyer) … INSERT listings … INSERT confirmed_sales … INSERT reviews …
DELETE FROM users WHERE id='…buyer…';
```
```
ERROR:  confirmed_sales is append-only; UPDATE/DELETE is not allowed
CONTEXT: SQL statement "UPDATE ONLY "public"."confirmed_sales" SET "buyer_user_id" = NULL WHERE …"
```
То же — на удалении листинга (`SET "listing_id" = NULL`) и животного (`SET "animal_id" = NULL`).

**Адресный контроль (ось 13):** удаление пользователя БЕЗ append-only строк проходит —
```
### D4: DELETE a user with NO append-only rows
DELETE 1
```
значит проба ловит именно этот класс, а не блокирует всё подряд.

**Почему это латентно, а не пожар сегодня:** в коде нет ни одного жёсткого удаления
`users`/`listings`/`animals` (`grep '\.delete(\|\.deleteMany('` → только `listing_photos`,
`favorites`, `saved_searches`); стирание по ФЗ-152 — мягкое (`users.erased_at`,
`admin-user.service.ts:242`, `retention.service.ts:126`). **Кусает** оно в двух случаях: (1) когда
оператор/будущий ADR решит выполнить обещанную псевдонимизацию удалением, (2) при ручной
операторской чистке данных — и упадёт непонятным `append-only` вместо ожидаемого поведения.

- **Антарая:** `стьяна` (объявление в миграции есть, действие невозможно) · авивека: приняли
  декларацию FK за работающий механизм.
- **Файлы:** `migrations/20260710_0039_confirmed_sales.sql`, `migrations/20260710_0040_reputation_storage.sql`, `database_schema.sql` (триггеры `trg_confirmed_sales_immutable` / `trg_reviews_immutable` / `trg_consents_immutable`).
- **Куда:** решение — архитектору (ADR): либо SET NULL заменить на явную операцию псевдонимизации
  (обновление через `SECURITY DEFINER`/GUC-исключение, как уже сделано для `app.ownership_transfer`),
  либо снять обещание ФЗ-152 из текста миграций. Молча оставлять нельзя — это обещание регулятору.

## (в) Обратный откат СХЕМЫ — 🔴 Ф-5 (P1): пути отката НЕТ

Что проверено фактом:

| вопрос | факт |
|---|---|
| есть ли down-миграции | `ls migrations/ \| grep -iE 'down\|rollback\|revert'` → **0** (идеология forward-only, ADR-0007 — ожидаемо) |
| есть ли журнал применённых миграций в БД | `select table_name … where table_name ~ 'migrat\|schema_ver\|_prisma'` → **0 строк**. Спросить живую базу «где ты стоишь» **нельзя** |
| есть ли раздел отката в MVP-ранбуке | `docs/06-operations/deployment-mvp.md` — раздела нет. Есть «Schema changes on update» (только вперёд) и «Backups & restore» |
| есть ли раздел отката вообще | `docs/06-operations/deployment.md:169` «Rollback Procedures» — но это **Target-State документ** (его собственная шапка в `deployment-mvp.md`: «The Kubernetes material in `deployment.md` … is Target State (Фаза 2+)»). Содержимое: «kubectl», «deployment dashboard», «HPA» — **к compose-MVP неприменимо** |
| есть ли неизменяемый артефакт кода для отката | `docker-compose.yml`: у `api`/`worker` **нет `image:`** — только `build:`. Откатывать нечего: откат = `git checkout <sha> && docker compose up -d --build` |

**Значит задокументированный путь отката для MVP = ничего, кроме общего «восстановить последний
`pg_dump`»** (`deployment-mvp.md`, «Backups & restore»), то есть **потеря до 24 ч данных (RPO ≤ 24 h,
заявлено там же)** + пересборка образа из git-SHA. Ни PITR/WAL, ни тегов образов, ни шага «что
делать, если миграция оказалась плохой».

Я НЕ пишу этот путь за них (задание: «если пути нет — это находка, не пиши за него»). Фиксирую
находку и одно измеренное обстоятельство в их пользу: **полный реплей всех 40 миграций — 2,84 с на
120 000 строк**, то есть «догнать схему обратно вперёд» дёшево; чего нет — так это способа **уйти
назад** и способа **узнать, где ты стоишь**.

- **Антарая:** `стьяна` (процедура отката объявлена — в чужом, Target-документе; для MVP действия нет).
- **Файлы:** `docs/06-operations/deployment-mvp.md`, `docs/06-operations/deployment.md:169-183`, `docker-compose.yml:54,74`, `migrations/`.

### Ф-6 (P2) — применение миграций НЕ атомарно, и это доказано

Документированная команда обновления (`deployment-mvp.md`, «Schema changes on update»):
`docker compose exec -T postgres psql … -v ON_ERROR_STOP=1 < "$f"` — **без `--single-transaction`**.
14 из 40 миграций (в т.ч. **0035, 0036, 0037**) не содержат собственных `BEGIN;/COMMIT;`
(`grep -c '^BEGIN;\|^COMMIT;'` → 0035:0, 0036:0, 0037:0; у 0038/0039/0040 — по 2, они обёрнуты).

Проба формы (файл-симулятор в скретчпаде, продуктовые файлы не трогались):
```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS audit5_probe_col TEXT;
UPDATE listings SET audit5_probe_col = 1/0;                       -- падает
CREATE INDEX IF NOT EXISTS idx_audit5_probe ON listings(audit5_probe_col);
```
```
$ psql … -v ON_ERROR_STOP=1 < fake_0041.sql
ALTER TABLE
ERROR:  division by zero
psql exit=3
$ … "select column_name … where column_name='audit5_probe_col'"
   column_name
------------------
 audit5_probe_col      ← колонка ОСТАЛАСЬ: миграция применена наполовину
 (индекс не создан)
```
**Адресный контроль** — тот же файл с `--single-transaction`:
```
ERROR:  division by zero
 col_present_after_single_tx
-----------------------------
                           0      ← откатилось целиком
```
Смягчающее: миграции идемпотентны, повторный прогон сходится (доказано ×2 выше). Но окно, в
котором схема — не N и не N-1, реально, а **журнала применённых миграций нет** (см. Ф-5), так что
оператор определяет состояние на глаз. Одна буква в документированной команде (`--single-transaction`)
это окно закрывает.

- **Антарая:** `прамада` (о неатомарности `psql < file` знают все, в команду не внесли).
- **Файлы:** `docs/06-operations/deployment-mvp.md` (блок «Schema changes on update»), `.github/workflows/ci.yml:136-146` (та же форма в CI).

## (г) Откат feature-toggle ON→OFF — Ф-7 (P2): НЕ мгновенный, и байт-в-байт не гарантирован

Читано по коду + прогнан профильный спек.

| toggle | кто читает | что даёт OFF |
|---|---|---|
| `reputation_reviews` | `grep -rn 'reputation_reviews' src --include=*.ts` (без spec) → **0 попаданий** | OFF **тривиально байт-в-байт**: код его не читает вовсе (слайс дормантный) |
| `sale_buyer_confirmation` | **0 попаданий** (одно упоминание в комментарии `transfer.service.ts:712`) | то же |
| `agent_service_auth` | **только точка выдачи токена** — `agent-credential.service.ts:150` | **НЕ мгновенный kill-switch** (ниже) |

Два независимых окна задержки:

1. **Кэш процесса.** `feature-toggle.service.ts:23` `CACHE_TTL_MS = 30_000`; `read()` (стр. 128-138)
   — read-through Map; `flip()` (стр. 119) делает `this.cache.delete(key)` **только в своём
   процессе**. При топологии MVP (`api` объявлен масштабируемым + отдельный `worker`) остальные
   процессы держат старое значение **до 30 с**. Это честно написано в докстринге сервиса
   («cross-instance flip propagation is bounded by CACHE_TTL_MS»), но **не в ранбуке оператора**.
2. **Уже выданные AGENT-токены.** Мастер-гейт проверяется ТОЛЬКО при обмене учётки на токен
   (`agent-credential.service.ts:150`). На пути запроса перепроверки нет:
   `AgentServiceTokenAuthenticator` — заглушка (`return null`), `BearerJwtAuthenticator` тоггл не
   читает, `AbilityFactory` тоже. Значит после OFF живой AGENT JWT работает до истечения
   `JWT_ACCESS_TTL` = **15m** (`.env.example:43`, `env.validation.ts:89`). Исключение — модерация:
   `moderation.service.ts:289` проверяет отдельный `agent_moderation` **на каждый запрос**, так что
   записи модератора-агента гаснут за ≤30 с; читающие способности (`read ModerationQueue/Listing/
   ContentReport` из профиля `moderation-agent`) — нет.

**Итого откат `agent_service_auth` ON→OFF:** новые токены прекращаются ≤30 с, **уже действующие
живут до 15 мин**. Для мастер-гейта агентской аутентификации это надо либо назвать в ранбуке, либо
закрыть перепроверкой на пути запроса.

**Прогон профильного спека (исполнено):**
```
$ npx jest src/lib/feature-toggle/feature-toggle.service.spec.ts
  ✓ caches reads within the TTL (single DB hit)
  ✓ rejects non-admin actors · updates the toggle and writes an audit entry atomically  … 7 passed
```
Обратите внимание на **дыру покрытия**: тест доказывает, что кэш *держит* значение внутри TTL, и
**ни один тест не доказывает, что кэш его ОТПУСКАЕТ** — счастливая половина замка (ось 12) для
самого отката отсутствует.

- **Антарая:** `самшая` (граница «30 с» объявлена, но не измерена ни тестом, ни прогоном) ·
  `стьяна` для второго окна (мастер-гейт объявлен «master gate», действием на пути запроса не является).
- **Файлы:** `backend/src/lib/feature-toggle/feature-toggle.service.ts:23,119,128`,
  `backend/src/modules/agent-auth/agent-credential.service.ts:150`,
  `backend/src/lib/auth/agent-service-token.authenticator.ts`, `.env.example:43`.

---

# ОСЬ 10 — СОВМЕСТИМОСТЬ

## (а) Legacy plaintext email — путь чтения ЖИВ, но путь ПОИСКА мёртв → 🔴 Ф-8 (P1)

Путь чтения на месте и покрыт тестом:
`crypto.service.ts:68` — `if (!value.startsWith('enc:v1:')) return value;` (legacy passthrough);
`crypto.service.spec.ts:39` — «passes through legacy (non-prefixed) plaintext on decrypt — rollout-safe». ✅

Но расшифровка помогает только строке, которую **уже нашли**. Ищут по слепому индексу:
`recovery.service.ts:68,107` и `admin-user.service.ts:73` → `where: { email_bidx: emailBlindIndex(email) … }`.
У до-0028 строки `email_bidx` — NULL.

**Исполненная проба:**
```sql
UPDATE users SET email='legacy@example.com', email_bidx=NULL, email_verified=true WHERE id=…;
SELECT count(*) AS found_by_bidx           FROM users WHERE email_bidx='…' AND email_verified AND erased_at IS NULL;
SELECT count(*) AS found_by_plaintext_email FROM users WHERE email='legacy@example.com';
```
```
 found_by_bidx            → 0     ← пользователь для восстановления пароля НЕ СУЩЕСТВУЕТ
 found_by_plaintext_email → 1     ← при этом строка цела
```
**Адресный контроль:** после проставления `email_bidx` тот же запрос даёт `1`. Значит проба меряет
именно индекс, а не сломанный запрос.

**Что видит пользователь:** `recovery.service.ts:60-72` намеренно отвечает одинаково при любом
исходе («no account enumeration») → `202 VERIFICATION_REQUIRED`, письмо **не уходит никогда**.
Это **тихий отказ** в чистом виде: ни ошибки, ни лога, ни метрики. Плюс такой пользователь
невидим в админском поиске по e-mail.

**И вот почему это не гипотеза, а вопрос времени.** Компенсация существует —
`backend/prisma/backfill/0028_pii_backfill.ts`, — но она **сирота**:
- `grep -n backfill backend/package.json` → **пусто** (npm-скрипта нет);
- `provision` (`docker-compose.yml:34-39`, `command: npm run db:provision`) её не вызывает;
- `grep -rniE 'backfill|0028_pii' docs/06-operations/**` → в MVP-ранбуке **ни одного упоминания**
  (единственное — в тексте N-1-ранбука, как описание проблемы, не как шаг);
- SQL-гейт `scripts/check-migration-backfill.sh` её **явно исключает** («0028's backfill is a TS
  companion … out of scope for a SQL gate»).

То есть при первом же апгрейде **населённой** базы ни один автоматический и ни один
задокументированный шаг не выполнит этот бэкфилл. Класс шире одного случая: **companion-бэкфиллы
не являются частью деплой-процедуры вообще** — следующий забудут так же.

- **Антарая:** `прамада` (написали инструмент, не встроили в процедуру) · `стьяна`.
- **Файлы:** `backend/prisma/backfill/0028_pii_backfill.ts`, `docs/06-operations/deployment-mvp.md`, `docker-compose.yml:28-45`, `backend/src/modules/identity/recovery.service.ts:60-72`, `scripts/check-migration-backfill.sh` (шапка).

## (б) до-0033 листинги без `market` · (в) до-0032 favorites без `offering_id` — ✅ ЗЕЛЁНО

Прогнан штатный гейт целиком на эфемерном PG (та же машинка, что и весь лейн):
```
$ PGHOST=localhost PGPORT=55433 … bash scripts/check-migration-backfill.sh
  ✅ 0033 market backfilled to 'livestock' + NOT NULL enforced
  ✅ 0032 favorites.offering_id == listing_id + saved_searches defaults correct
  ✅ 0036 consents.seq backfilled monotonically by insertion order (later row wins)
✅ all backfill migrations produce correct data on POPULATED tables (AUDIT4 P2-3)
```
Гейт для каждого случая **сначала роняет колонку** (симулируя до-миграционное состояние), сеет
строки-носители, **проигрывает миграцию дважды** и проверяет значение + NOT NULL. Идемпотентный
повтор 0033 на заполненной базе — именно то, что просило задание, — зелёный.

## (г) Старые refresh-токены при смене формата (0020) — ✅ ЗЕЛЁНО, отвергаются/работают корректно, без 500

0020 добавил `ip_address`/`user_agent`/`last_used_at`/`revoked_reason` — **все nullable**. Проба
воспроизводит строку токена, созданную ДО 0020 (только до-0020 набор колонок), и прогоняет ровно
тот поток, что делает `refresh-token.service.ts:59-108`:
```sql
INSERT INTO refresh_tokens (id,user_id,token_hash,family_id,device_label,issued_at,expires_at) VALUES (…);
SELECT id, revoked_at, expires_at > now() AS not_expired, ip_address, user_agent, last_used_at, revoked_reason
  FROM refresh_tokens WHERE token_hash='legacyhash';
UPDATE refresh_tokens SET revoked_at=now() WHERE id=… AND revoked_at IS NULL;   -- CAS-заявка
INSERT INTO refresh_tokens (…, rotated_from, …) VALUES (…) RETURNING id, family_id;
```
```
 id … | revoked_at | not_expired | ip_address | user_agent | last_used_at | revoked_reason
 …cb01|            | t           |            |            |              |
UPDATE 1
 id 1f34a95f-… | family_id 00000000-…cc01     ← ротация прошла, семья сохранена
```
Токен не «отвергается некорректно» и не даёт 500 — он **ротируется штатно**, новые поля просто
остаются NULL. Формат токена непрозрачный (поиск по `token_hash`), так что смены формата как
таковой не было.

## (д) Дрейф Prisma-интроспекции — 🔴 Ф-3 (P1): `schema.prisma` не совпадает НИ С ОДНИМ путём

Требование задания выполнено буквально: `prisma db pull` гонялся **на копии** файла в скретчпаде,
рабочее дерево не трогалось (`git status backend/prisma` → пусто).

CI делает ровно это (`.github/workflows/ci.yml:66-73`): применяет `database_schema.sql` → `npm run
db:pull` → `git diff --exit-code prisma/schema.prisma`. Воспроизведение один-в-один:

```
$ psql -d audit5_ci -f database_schema.sql            # ТОЛЬКО канонический файл, как в CI
$ DATABASE_URL=…/audit5_ci npx prisma db pull --schema=<копия>
$ diff prisma/schema.prisma <копия>
RED: drift, 50 changed lines

$ то же против audit5_replay (schema + миграции ×2)
RED: drift, 50 changed lines
```

**Природа расхождения — чистый ПОРЯДОК колонок, ничего больше.** Доказано мультимножеством строк:
```
$ diff <(sort prisma/schema.prisma) <(sort <копия>)
(пусто)  → YES — identical multisets of lines: differences are column ORDER only
```
Примеры перестановок: `listings.view_count/market/content_updated_at` (0031/0033/0035),
`users.erased_at/email_bidx` (0015/0028), `audit_log.actor_principal_type` (0016),
`animal_ownership_history.organization_id` (0023) — во всех случаях канонический
`database_schema.sql` объявляет колонку в логическом месте, а закоммиченный `schema.prisma` держит
её в конце, то есть **в порядке исторического `ALTER TABLE … ADD COLUMN`**.

**Корень (и он не «забыли запустить db:sync»):** `schema.prisma` и `database_schema.sql` правились
одним и тем же коммитом `4fa63d9` — то есть `db:sync` запускали. Просто запускали **против
долгоживущей dev-базы**, накопившей историю ALTER-ов, а CI тянет из базы, собранной из
канонического файла. **Источник синка ≠ источник гейта** → шаг «Prisma schema drift check» на HEAD
`c44874c` **красный**.

Влияния на рантайм нет (порядок полей в Prisma-схеме косметический). Опасность другая и известная:
вечно-красный сторож через неделю снимают флагом.

- **Антарая:** `бхранти-даршана` (гейт меряет базу, собранную не тем путём, которым синкают файл) ·
  `анавастхитатва`.
- **Файлы:** `backend/prisma/schema.prisma`, `database_schema.sql`, `.github/workflows/ci.yml:66-73`.

---

# 🔴 Ф-1 (P0, БЛОКЕР) — свежая инсталляция МОЛЧА теряет петлю уведомлений saved-search

Это самая тяжёлая находка лейна. Она сидит ровно на шве двух моих осей: путь установки (10) и
неспособность заметить/вернуть (9).

**Что произошло.** Миграция 0037 — data-only сид двух шаблонов `saved_search_matched` ×(ru,en).
Контракт проекта (и `CLAUDE.md`, и `deployment-mvp.md`): справочные данные **зеркалируются** в
`database_schema.sql`, чтобы оба пути бутстрапа сходились. Для 0030 это сделано
(`grep -c transfer_initiated database_schema.sql` → 3). **Для 0037 — нет:**
`grep -c saved_search_matched database_schema.sql` → **0**.

**Исполненная проба — расхождение справочных ДАННЫХ между путями:**
```
=== reference-DATA diff: fresh(schema+seed) vs replay(schema+migrations×2)
  ok   supported_languages          5 == 5
  ok   species / breeds / cities / feature_toggles / moderation_reasons / decision_templates …
  DIFF notification_templates       fresh=22 replay=24
  ok   agent_capability_profiles    1 == 1
```
```
replay: saved_search_matched | EMAIL | en
        saved_search_matched | EMAIL | ru
fresh : count = 0
```

**Почему это ТИХО.** `notification-writer.service.ts:75-79`:
```ts
const template = await this.loadTemplate(templateName, language);
if (!template) {
  this.logger.warn(`Notification template '${templateName}' (${language}) not found — no row written`);
  return false;
}
```
Одна строка `warn` — и всё. Ни ошибки, ни метрики, ни сигнала здоровья. Пользователь, сохранивший
поиск, просто **никогда** не получает уведомлений о подходящих объявлениях; продукт выглядит
работающим. Это первая петля возврата спроса (H4) — она не «деградирует», она **отсутствует**.

**Доказательство исполнением, с адресным контролем (ось 13).** Один и тот же e2e-файл, одно и то
же дерево (включая чужую мутацию ability.factory — она в обоих плечах), единственная переменная —
БАЗА:

| база | как собрана | результат |
|---|---|---|
| `audit5_ci` | **как в CI и как в проде**: `database_schema.sql` + `npm run seed` | **13 failed / 10 passed из 23** |
| `audit5_replay` | `database_schema.sql` + реплей миграций (есть 0037) | **23 passed / 23** ✅ |

```
● H4-12: a produced Listing.Activated flows through the relay to a saved-search notification
    expect(received).toBe(expected)
    Expected: 1
    Received: 0
      > 487 |     expect(await countFor(s, listing)).toBe(1);
```
Тест сам шаблон не сеет (`beforeAll`, `saved-search-match.e2e-spec.ts:142-154`) — он полагается на
то, что база его уже содержит. Локальный dev-PG содержит (там 0037 проигрывали руками), поэтому
базовая линия оркестратора зелёная. **CI и свежий прод — нет.**

**Радиус:** (1) продукт — молча мёртвая H4-петля на любой новой инсталляции; (2) CI — красный шаг
e2e; (3) класс — любая будущая data-only миграция уедет тем же путём.

- **Антарая:** `прамада` (конвенция зеркалирования соблюдена для 0030, для 0037 забыта) ·
  `бхранти-даршана` (см. Ф-2 — гейт объявляет одно, меряет другое).
- **Файлы:** `migrations/20260708_0037_saved_search_matched_notification.sql`, `database_schema.sql`,
  `backend/src/modules/notification/notification-writer.service.ts:75-79`,
  `test/saved-search-match.e2e-spec.ts`, `backend/src/seed.ts:30-35` (список `SEED_FILES` — 0037 в нём тоже нет).
- **Кому:** backend-engineer (зеркалирование справочных данных) + reviewer-qa (почему зелёный
  локальный e2e не поймал) — я продуктовые файлы не правлю.

## 🔴 Ф-2 (P1) — гейт объявляет «оба пути идентичны», а меряет только DDL

Причина, по которой Ф-1 прожил три коммита. Джоба `migration-drift` (`.github/workflows/ci.yml:107-163`)
собирает две базы и сравнивает их так:
```bash
pg_dump -d canonical --schema-only --no-owner --no-privileges --no-comments -n public | norm > canonical.ddl
pg_dump -d migrated  --schema-only … | norm > migrated.ddl
diff -u canonical.ddl migrated.ddl
```
Сообщение шага — дословно: **«BLOCKING — both bootstrap paths must be identical»**. Но `--schema-only`
означает **только структуру**; справочные СТРОКИ в сравнение не попадают вовсе. Мой прогон показал:
DDL сходится, а данные — нет (22 против 24). Зелёный гейт был правдив ровно в том, что мерил, и лжив
в том, что объявлял.

Дополнительно: обе базы джобы стартуют с `database_schema.sql`, поэтому путь «реплей 0001–0040 на
ПУСТОЙ базе» не проверяется вообще — а именно в нём живёт расхождение порядка колонок из Ф-3.

- **Антарая:** `бхранти-даршана` (замер мерит не то, что объявляет).
- **Файл:** `.github/workflows/ci.yml:107-163` (особенно строки 152-163).

## Ф-10 (P3) — `confirmed_sales` рождается с дырой в «записи истины»

0039 не содержит бэкфилла (`grep -niE 'backfill|INSERT INTO confirmed_sales|FROM ownership_transfers'
migrations/20260710_0039_confirmed_sales.sql` → пусто): передачи владения, **завершённые до** 0039
(и завершённые N-1-подом в окне выката), строки `confirmed_sales` не получают никогда. Для
дормантного FORM-слайса это осознанно, но нигде не сказано, что «запись истины» начинается не с
нуля, — а на неё будет вешаться репутация (ADR-0039/0040).

- **Антарая:** `самшая` (объём пропуска не назван числом).
- **Файл:** `migrations/20260710_0039_confirmed_sales.sql`.

---

## Сводная таблица находок

| # | severity | ось | антарая | миграция / файл | суть |
|---|---|---|---|---|---|
| **Ф-1** | **P0 блокер** | 10 (+9) | `прамада` · `бхранти-даршана` | 0037 · `database_schema.sql` · `notification-writer.service.ts:75` | шаблоны `saved_search_matched` не зеркалированы → свежая установка молча без H4-уведомлений; e2e 13/23 падает на CI-образной базе (контроль: 23/23 на replay) |
| **Ф-8** | **P1 блокер** | 10 | `прамада` · `стьяна` | `prisma/backfill/0028_pii_backfill.ts` | companion-бэкфилл PII — сирота (нет npm-скрипта, нет в provision, нет в ранбуке); до-0028 строки невидимы для восстановления пароля, ответ тот же 202 → тихо |
| **Ф-2** | P1 | 10 | `бхранти-даршана` | `.github/workflows/ci.yml:152-163` | гейт «оба пути идентичны» диффит только `--schema-only`; расхождение справочных ДАННЫХ невидимо |
| **Ф-3** | P1 | 10 | `бхранти-даршана` · `анавастхитатва` | `backend/prisma/schema.prisma` · `ci.yml:66-73` | `schema.prisma` не совпадает ни с каноническим, ни с replay-путём (50 строк, чистый порядок колонок) → шаг drift-check на HEAD красный |
| **Ф-4** | P1 (латентно) | 9 | `стьяна` | 0039 · 0040 | `ON DELETE SET NULL` (объявлено как «ФЗ-152 pseudonymise») невозможно на append-only: DELETE users/listings/animals → `confirmed_sales is append-only` |
| **Ф-5** | P1 | 9 | `стьяна` | `deployment-mvp.md` · `docker-compose.yml:54,74` | пути отката для MVP нет: 0 down-миграций, нет журнала применённых, раздел отката только в Target-K8s-доке, у api/worker нет тега образа |
| **Ф-6** | P2 | 9 | `прамада` | `deployment-mvp.md` · 0035/0036/0037 | документированное применение неатомарно (`psql < file` без `--single-transaction`) — доказано половинчатым применением + контролем |
| **Ф-7** | P2 | 9 | `самшая` · `стьяна` | `feature-toggle.service.ts:23` · `agent-credential.service.ts:150` | OFF не мгновенен: ≤30 с кэш процесса (кросс-инстансно) + живые AGENT JWT до 15 мин; теста на истечение кэша нет |
| **Ф-9** | P3 | 9 | `анавастхитатва` | `runbooks/migration-deploy-order.md` | таблица N-1 обрывается на 0036; у 0037 нет обязательной `-- N-1:` строки. Закрыто пробами: 0037–0040 SAFE |
| **Ф-10** | P3 | 10 | `самшая` | 0039 | нет бэкфилла историй завершённых передач → «запись истины» стартует с неназванной дырой |

## Что в этих осях ЗЕЛЁНО (проверено, а не предположено)

- Свежий бутстрап: 41 таблица за **1,03 с**; сид **идемпотентен** (два прогона — идентичные счётчики).
- Реплей всех 40 миграций идемпотентен и дёшев: **2,13 / 2,16 с** на пустой базе, **2,84 с** на
  **120 000 строк / 70 МБ**.
- N-1-совместимость **0035, 0036, 0038, 0039, 0040** — SAFE, каждая исполненной пробой; у 0036 есть
  и обратная проба (GENERATED ALWAYS отвергает запись приложением).
- 0033 остаётся UNSAFE ровно как классифицировано в ранбуке — воспроизведено на HEAD.
- Бэкфиллы 0032/0033/0036 на заполненной базе — штатный гейт зелёный на эфемерном PG16.14.
- Refresh-токены до-0020 ротируются штатно, без 500 и без потери семьи.
- Legacy-plaintext passthrough при расшифровке жив и покрыт юнит-тестом.
- `feature_toggles`, `agent_capability_profiles`, шаблоны transfer-* — зеркалированы в
  `database_schema.sql` корректно (сходятся на обоих путях); ошибся только 0037.

## Гигиена прогона

- Эфемерный контейнер `zoolink-audit5-pg` **удалён** (`docker rm -f` → `docker ps -a --filter
  name=zoolink-audit5` → 0 строк); все базы прогона жили внутри него и ушли вместе с ним.
- Живой dev-PG и compose-стек ZooLink **не затронуты** (лейн целиком на 55433).
- Продуктовый код и схема **не изменялись**; `prisma db pull` — только на копиях в скретчпаде.
- Ничего не коммичено. Итоговый `git status` — чист, кроме `AUDIT5/` (отчёты лейнов) и
  предсуществующего шума `.claude/`.
- **Наблюдение по ходу (для протокола):** в середине прогона в дереве присутствовала **чужая**
  намеренная мутация другого лейна — `backend/src/lib/auth/ability.factory.ts`
  (`return matrix; // AUDIT5 T1 MUTATION`, снимает сужение AGENT до `matrix(role) ∩ scope`).
  Я её **не откатывал** (не мой лейн — по всем признакам активная проба оси 13); к финальной
  проверке она уже была снята автором. На мои выводы влияния нет: пробы SQL/схемные, а
  единственный запуск e2e прогонялся с ней **в обоих плечах** сравнения.
