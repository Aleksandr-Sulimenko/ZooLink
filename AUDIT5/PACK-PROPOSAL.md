# AUDIT5 — PACK-PROPOSAL (DDL-предложение + список мутаций на гейт держателя, ADR-0020)

**Дата:** 2026-08-04 · **Ветка:** `backend` · **HEAD:** `c44874c` · **Автор лейна:** architect (проектный)
**Статус:** ✅ **ГЕЙТ-ПАС ДЕРЖАТЕЛЯ ПОЛУЧЕН 2026-08-04** (m-20260804-234834). Реализация — только после
слова владельца на заход (держатель гейтит код на этом). Пока — **не код, ничего не менялось** в схеме/коде/CI.

---

## ✅ GATE-PASS — РЕЗОЛЮЦИИ ДЕРЖАТЕЛЯ по Q1–Q8 (контракт реализации; условия ОБЯЗАТЕЛЬНЫ)

- **Р-9:** приняты **Р9-A + Р9-B**. Смысл, по которому мерить: гейт дрейфа обязан иметь ДВА НЕЗАВИСИМЫХ
  ПУТИ к одному состоянию схемы (пока оба стартуют с одного файла — мутация в него зелена по построению).
  Р9-A даёт второй путь; Р9-B даёт СЛОЙ (не второй путь), но закрывает Р-9+Р-10 разом. Берём оба.
- **Q1:** `uq_confirmed_sales_transfer` **ОСТАЁТСЯ ПОЛНЫМ** (мой довод принят: на CONFIRMED-only факте полный
  UNIQUE — правда, не ограничение). C-1 из §сопутствующее **снята**. ⚠️ УСЛОВИЕ-ЗАМОК: отмена/спор ПОСЛЕ
  подтверждения НЕ смеет удалять/подменять строку факта (иначе полный UNIQUE заблокирует замену) — держится Q3.
- **Q2:** `confirmed_sales.status` — **оставить колонку + суженный `CHECK (status='CONFIRMED')`** (надгробие:
  падающее не восстанавливают по памяти, тихо исчезнувшее — восстанавливают). **КОММЕНТАРИЙ на констрейнте:
  «PENDING живёт в sale_confirmations».**
- **Q3:** диспут = **подтип `content_report` (ADR-0040)**, НЕ ключ на companion (ищи существующий шов; диспут =
  утверждение третьей стороны, не состояние продажи). Правило-замок: **факт СЛУЧИЛСЯ и не стирается; отмена/спор
  — НОВАЯ ЗАПИСЬ О НЁМ, не правка его.** → `sale_confirmations` НЕ ключует факт для диспута.
- **Q4:** **β** — companion `review_states`. A-iii+β = единый паттерн проекта «неизменяемый факт + мутабельное состояние».
- **Q5:** `UNIQUE(supersedes_review_id)` — **ДА, строже moderation_decisions, осознанно** (правка отзыва линейна,
  оверрайд решения ветвится). ⚠️ ОБЯЗАТЕЛЬНО: **причину записать КОММЕНТАРИЕМ НА КОНСТРЕЙНТЕ** (иначе «приведут к
  единообразию» с moderation_decisions и снимут UNIQUE).
- **Q6:** «одна текущая на (sale,direction)» **остаётся DB-инвариантом** (uq_reviews_supersedes +
  uq_reviews_root_per_direction + VIEW reviews_current) — принято.
- **Q7:** попытка восстановить pre-0001 baseline **авторизована** (артефакт, не продакшен). Если НЕ восстановим →
  Р9-B один как MVP, но с ДВУМЯ условиями: (1) ограничение записано **ЯВНО в артефакт гейта** («второго
  независимого пути нет, гейт проверяет самосогласованность + реестр»); (2) отсутствие Р9-A остаётся **В ДОЛГЕ
  с адресом**, не растворяется в «сделано».
- **Q8:** **МЕТА-ГЕЙТ, не рукописный реестр**: каждый новый `chk_`/`uq_`/`trg_` в каноне обязан быть ⊆ реестра,
  иначе гейт краснеет. ⚠️ **Проверить сам мета-гейт**: добавь констрейнт МИМО реестра → гейт обязан покраснеть
  (не покраснел = мета-гейта нет, есть его описание).
- **Приёмка (без изменений):** 2 коммита (схема/гейты, откат порознь), каждый фикс краснеет от СВОЕЙ мутации,
  M-1..M-4 приняты, 3 декоративные оси переделаны. **Не покраснело = пак не принят, сколько бы зелёного рядом ни было.**
**Вход:** вердикт держателя по развилкам A/B/Р-9/Р-10 + `AUDIT5/{architect,reviewer-qa,backend-engineer}.md`.
**Сверка фактов:** DDL прочитан по `database_schema.sql` (confirmed_sales `:638-697`, reviews `:708-745`,
moderation_decisions `:447-472`, consents `:1208-1237`), CI-джоб `migration-drift` (`.github/workflows/ci.yml:107-163`),
миграция `0001` (заголовок), e2e `backend/test/reputation-storage.e2e-spec.ts`. Живой psql не опрашивался
(read-only задача); все DDL-утверждения — из текста канона.

> **Все DDL ниже — СКЕТЧ** (синтаксис CREATE/ALTER, не финальная миграция). Всё помечено **FORM/DORMANT**:
> feature_toggles `sale_buyer_confirmation` и `reputation_reviews` = OFF, поведения нет, 0 markSold-строк,
> transfer-строки все CONFIRMED → реформа дёшева сейчас. Каждый спорный выбор вынесен **вопросом держателю**
> (§Открытые вопросы), не решён самовольно.

---

## §A-iii — PENDING = намерение, не факт; вынос из append-only

### Что именно сломано (сверено с DDL)
`confirmed_sales` **уже** append-only (`trg_confirmed_sales_immutable`, `:694-696`) и **уже** несёт полную
машину состояний: `status DEFAULT 'PENDING_CONFIRMATION'` (`:662`), словарь
`PENDING_CONFIRMATION|CONFIRMED|DISPUTED|EXPIRED|CANCELLED` (`chk_confirmed_sales_status :682-683`) +
интент-колонки `nominated_buyer_user_id/seller_confirmed_at/buyer_confirmed_at/expires_at` (`:665-669`).
Переход `PENDING→CONFIRMED` = UPDATE = заблокирован триггером. Transfer-путь пишет born-CONFIRMED (ок),
markSold-путь (спека 18 §4, toggle OFF) реализовать нельзя. Таблица спроектирована под машину состояний,
а append-only разрешает ровно одно ребро из семи. Это конфликт **внутри самого ADR-0038** (§4 «своя машина
состояний» vs sketch §5 «не изобретать второй путь неизменяемости»).

### Решение — раздельные роль/форма (это ветка A-iii из `architect.md §4.2`)
**Факт** (что сделка ПОДТВЕРЖДЕНА) — остаётся в `confirmed_sales`: append-only, стабильный `id`
(на нём висит `reviews.confirmed_sale_id`, funnel, агрегат репутации, путь ФЗ-152 — ничего не двигается).
**Намерение/переговоры** (markSold PENDING-жизненный цикл) — уезжают в НОВУЮ мутабельную таблицу.

**Имя таблицы (предложение):** `sale_confirmations` — «подтверждения-в-процессе». (Альтернатива
`sale_negotiations`; выбор — держателю.)

#### DDL-скетч — новая мутабельная таблица (FORM/DORMANT)
```sql
-- FORM/DORMANT: markSold buyer-counter-confirmation lifecycle. Behaviour behind
-- feature_toggles.sale_buyer_confirmation (OFF). Transfer path NEVER writes here (born-CONFIRMED).
CREATE TABLE sale_confirmations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- deal-in-negotiation subject (same polymorphic shape as confirmed_sales)
    offering_type           VARCHAR(30) NOT NULL DEFAULT 'ANIMAL_LISTING',
    offering_id             UUID,
    listing_id              UUID REFERENCES listings(id) ON DELETE SET NULL,
    animal_id               UUID REFERENCES animals(id)  ON DELETE SET NULL,
    market                  VARCHAR(9)  NOT NULL,
    seller_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    buyer_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    seller_organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
    buyer_organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
    nominated_buyer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    anchor_type             VARCHAR(20) NOT NULL DEFAULT 'LISTING_MARK_SOLD',
    -- MUTABLE lifecycle — the whole point of the split:
    status                  VARCHAR(24) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    seller_confirmed_at     TIMESTAMPTZ,   -- markSold time (seller side)
    buyer_confirmed_at      TIMESTAMPTZ,   -- buyer counter-confirm
    expires_at              TIMESTAMPTZ,   -- PENDING timeout horizon
    -- back-pointer to the FACT, set once negotiation resolves to CONFIRMED (NULL before that)
    confirmed_sale_id       UUID REFERENCES confirmed_sales(id) ON DELETE SET NULL,
    actor_id                UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type    VARCHAR(10) NOT NULL DEFAULT 'HUMAN',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- MUTABLE: has updated_at + trigger
    CONSTRAINT chk_sale_conf_status      CHECK (status IN
        ('PENDING_CONFIRMATION','CONFIRMED','DISPUTED','EXPIRED','CANCELLED')),
    CONSTRAINT chk_sale_conf_anchor      CHECK (anchor_type IN ('LISTING_MARK_SOLD')),
    CONSTRAINT chk_sale_conf_actor_ptype CHECK (actor_principal_type IN ('HUMAN','AGENT')),
    -- biconditional: a CONFIRMED negotiation has produced its fact row, others have not (mirror chk_moddec_override)
    CONSTRAINT chk_sale_conf_confirmed_link CHECK (
        (status = 'CONFIRMED' AND confirmed_sale_id IS NOT NULL) OR
        (status <> 'CONFIRMED' AND confirmed_sale_id IS NULL))
);
-- "одна ЖИВАЯ переговорная на listing" — CANCELLED/EXPIRED освобождают listing под новую попытку
-- (спека 18 §4:262 «отменённая может быть заменена» — теперь НЕ мёртвая буква, но живёт ЗДЕСЬ, не в confirmed_sales, см. §Открытые-вопросы Q1)
CREATE UNIQUE INDEX uq_sale_conf_live_per_listing ON sale_confirmations(listing_id)
    WHERE status IN ('PENDING_CONFIRMATION','DISPUTED');
CREATE INDEX idx_sale_conf_confirm_scan ON sale_confirmations(expires_at) WHERE status = 'PENDING_CONFIRMATION';
CREATE TRIGGER trg_sale_confirmations_updated_at
    BEFORE UPDATE ON sale_confirmations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();   -- reuse existing fn (:826)
```

#### DDL-скетч — `confirmed_sales` становится CONFIRMED-only ФАКТОМ (дельта, FORM)
```sql
-- intent/negotiation columns move to sale_confirmations
ALTER TABLE confirmed_sales DROP COLUMN nominated_buyer_user_id;
ALTER TABLE confirmed_sales DROP COLUMN seller_confirmed_at;
ALTER TABLE confirmed_sales DROP COLUMN buyer_confirmed_at;
ALTER TABLE confirmed_sales DROP COLUMN expires_at;
-- status is no longer a machine: a row EXISTS iff the sale is confirmed fact
ALTER TABLE confirmed_sales ALTER COLUMN status DROP DEFAULT;
ALTER TABLE confirmed_sales DROP CONSTRAINT chk_confirmed_sales_status;
ALTER TABLE confirmed_sales ADD  CONSTRAINT chk_confirmed_sales_status CHECK (status = 'CONFIRMED');
-- confirm_scan index предицировал по PENDING+expires_at (обе величины ушли)
DROP INDEX idx_confirmed_sales_confirm_scan;
-- KEEP: uq_confirmed_sales_transfer как ПОЛНЫЙ UNIQUE (см. §Открытые-вопросы Q1 — под A-iii он остаётся верным)
-- KEEP: confirmed_at (момент, когда факт родился)
```
**Рекомендация по `status`:** оставить колонку с суженным `CHECK (status='CONFIRMED')` (маленький диф,
явный аудиторский маркёр), НЕ дропать (дроп чище семантически, но ломает возможных читателей). Держателю —
Q2.

#### Как born-CONFIRMED transfer-путь НЕ ломается
Transfer-путь пишет `confirmed_sales` напрямую, **без** строки в `sale_confirmations` (anchor='TRANSFER',
`ownership_transfer_id` заполнен, `confirmed_at=now`). Единственная правка писателя (импл-нота коммита-1,
не в этом файле): `transfer.service` перестаёт вписывать ушедшие колонки (`nominated_buyer_user_id` он и не
писал; `seller_confirmed_at/buyer_confirmed_at` синтетические — их роль для факта покрывает `confirmed_at`).
Пассивный захват при accept() остаётся атомарным.

#### Как при CONFIRM новой таблицы рождается append-строка факта (поведение, DORMANT за toggle)
В ОДНОЙ транзакции подтверждения (`sale_confirmations.status PENDING→CONFIRMED`): INSERT строки
`confirmed_sales` (anchor='LISTING_MARK_SOLD', `ownership_transfer_id=NULL`, `confirmed_at=now`, стороны
скопированы, actor=подтверждающий) → `sale_confirmations.confirmed_sale_id := new id`, `status='CONFIRMED'`.
Биконстрейнт `chk_sale_conf_confirmed_link` гарантирует, что CONFIRMED-переговорная ⇔ есть строка факта.
Failure INSERT-а факта откатывает подтверждение (атомарность, как у transfer-пути сегодня).

**Соответствие инвариантам:** ни одного нарушенного; новая обязанность «две таблицы сходятся» проверяема
одним запросом (у каждой CONFIRMED-переговорной ровно одна строка факта — биконстрейнт), в отличие от
«правильно ли классифицирована колонка» у отвергнутой ветки A-ii.

---

## §сопутствующее (что DDL, что доки) — в коммит-1

| # | Правка | Тип | Где |
|---|---|---|---|
| C-1 | `uq_confirmed_sales_transfer` полный→partial | **см. Q1: под A-iii правка НЕ нужна** | — |
| C-2 | дрейф `confirm_expires_at`→`expires_at` | **ДОКОВАЯ сверка, не DDL** | `docs/specs/18-reputation.md:175,189,254,256,270,272,309-312,370` (×7 упоминаний `confirm_expires_at` в sketch §5; схема давно `expires_at`, `:669`). Плюс: под A-iii `expires_at` вообще уезжает в `sale_confirmations` → спека 18 §4/§5 переписывается целиком под раздельную модель, не только переименование колонки |
| C-3 | инверсия статусов ADR-0020/0021 | **ДОКОВАЯ правка** | `docs/04-decisions/0020-*.md` и `0021-*.md`: `Status: Proposed`→`Accepted`. Сверено: 0020 реализован (миграции 0029/0036, `0040§C`, `ConsentService` живёт), 0021 реализован (0030, `NotificationConsumer`), а Accepted-ADR-0039 «Builds on ADR-0020…0021» стоит на двух Proposed. Иерархия истины: схема ушла впереди ADR |
| C-4 | ADR-0038 §4 Amendment | **ДОКОВАЯ** | «PENDING-жизненный цикл вынесен в `sale_confirmations`; `confirmed_sales` = CONFIRMED-only факт». Это амендмент принятого ADR (сужение словаря + вынос колонок), не отмена решения |
| C-5 | ADR-0039 §3 Amendment | **ДОКОВАЯ** | супersede-механизм отзывов: forward `superseded_by_id`→backward `supersedes_review_id`+view (см. §B-ii); модерационное состояние — §B-iv |

> **Про C-1 (partial-unique на confirmed_sales):** держатель просил заменить полный `UNIQUE(ownership_transfer_id)`
> на partial «одна живая на transfer», чтобы «отменённая могла быть заменена». **Под A-iii эта правка
> становится избыточной** и, вероятно, неверной — обоснование в §Открытые-вопросы Q1. Не вношу самовольно.

---

## §B-ii — reviews: forward `superseded_by_id` → backward `supersedes_review_id`

### Что сломано (сверено)
`reviews` append-only (`trg_reviews_immutable :742`), forward `superseded_by_id UUID REFERENCES reviews(id)`
(`:721`), partial-unique `uq_reviews_current_per_direction … WHERE superseded_by_id IS NULL` (`:737`),
`seq GENERATED` (`:728`). Forward-указатель требует UPDATE **старой** строки, чтобы пометить её
преемником → заблокирован → `superseded_by_id` навсегда NULL → partial-unique покрывает **все** строки =
работает как полный, а правка-в-грейс (ADR-0039 §3) структурно невозможна. Зелёный тест
`reputation-storage.e2e:95` кодифицирует недостижимый инвариант.

### DDL-скетч (FORM/DORMANT) — обратный указатель, совместимый с append-only ПО ПОСТРОЕНИЮ
Обратный указатель пишется в момент INSERT **новой** строки (пишу о себе, не о чужой) — ровно модель
`moderation_decisions` (`supersedes_decision_id :460`, `chk_moddec_override`, `idx_moddec_supersedes :472`).
```sql
DROP INDEX uq_reviews_current_per_direction;
ALTER TABLE reviews DROP COLUMN superseded_by_id;
-- новая строка (правка-в-грейс) НАЗЫВАЕТ строку, которую заменяет
ALTER TABLE reviews ADD COLUMN supersedes_review_id UUID REFERENCES reviews(id) ON DELETE RESTRICT;
-- (1) UNIQUE — у предка не более ОДНОГО наследника (запрет раздвоения истории; ТРЕБОВАНИЕ держателя)
CREATE UNIQUE INDEX uq_reviews_supersedes ON reviews(supersedes_review_id) WHERE supersedes_review_id IS NOT NULL;
-- (2) один КОРЕНЬ цепочки на (сделка, направление) → одна цепочка → одна голова.
--     Корень = строка, которая ничего не заменяет (supersedes_review_id IS NULL).
--     Это СОХРАНЯЕТ «одна-текущая-на-(sale,direction)» как DB-инвариант (см. Q6 — сильнее, чем в architect.md §5.3)
CREATE UNIQUE INDEX uq_reviews_root_per_direction ON reviews(confirmed_sale_id, direction) WHERE supersedes_review_id IS NULL;
-- idx_reviews_subject_market предицировал по superseded_by_id IS NULL (колонка ушла) → предикат снять,
-- «текущесть» обеспечивает VIEW ниже
DROP INDEX idx_reviews_subject_market;
CREATE INDEX idx_reviews_subject_market ON reviews(subject_user_id, market)
    WHERE moderation_status = 'APPROVED' AND is_visible = TRUE;
-- seq (:728) ОСТАЁТСЯ — порядок фактов + детерминированный tiebreak (урок 0036). idx_reviews_current_seq (:740) остаётся.
```

### Именованное место «текущего» (требование держателя п.2) — VIEW `reviews_current`
```sql
-- ЕДИНСТВЕННОЕ именованное место, где резолвится «текущий отзыв». Голова цепочки = строка, которую
-- никто не заменяет. uq_reviews_supersedes гарантирует линейность (≤1 наследник) → голова единственна.
CREATE VIEW reviews_current AS
    SELECT r.*
    FROM reviews r
    WHERE NOT EXISTS (SELECT 1 FROM reviews s WHERE s.supersedes_review_id = r.id);
```
Читатели репутации/публикации ходят в `reviews_current` (не повторяют NOT-EXISTS по коду). `seq DESC` —
резервный детерминизм, если понадобится упорядочить головы.

**Почему моя модель сильнее сводки `architect.md §5.3`:** там B-ii «жертвует» DB-инвариантом «одна голова
на (сделка,направление)» (уводит его в приложение). Здесь пара `uq_reviews_root_per_direction` +
`uq_reviews_supersedes` **сохраняет** его как DB-инвариант: один корень (правка-в-грейс не создаёт второй
корень, она наследует), линейная цепочка, одна голова. Обе части пишутся при INSERT → append-only цел.
Остаточное (импл-инвариант): `supersedes_review_id` ДОЛЖЕН ссылаться на строку той же
`(confirmed_sale_id, direction)` — обеспечивает писатель; при желании — composite-FK/триггер позже (Q5).

---

## §B-iv — `moderation_status`/`is_visible` тоже мутабельны, заблокированы append-only

`reviews.moderation_status DEFAULT 'PENDING'` (`:719`, переходы PENDING→APPROVED/REJECTED/CHANGES_REQUESTED,
ADR-0040 §2) и `is_visible DEFAULT FALSE` (`:720`, double-blind: планировщик раскрывает обе стороны вместе,
ADR-0039 §3) — меняются по замыслу, оба заблокированы `trg_reviews_immutable`. **Любая** ветка B-ii,
решающая только указатель, оставит `reviews` нереализуемой ещё по двум осям. Держатель дал НАПРАВЛЕНИЕ
«факт + состояние рядом», не механизм. Два варианта, выбор — за держателем:

### Вариант α — переходы = НОВАЯ superseding-строка тем же механизмом B-ii (одна модель, всё append-only)
- **Механизм:** сменить `moderation_status`/`is_visible` = вставить новую строку отзыва, супersede-ящую
  старую, с новым состоянием.
- **Цена:** каждый модерационный переход и каждый флип видимости = новая ПОЛНАЯ строка (дублируется
  rating/body/facets). Double-blind раскрытие на планировщике = по строке на каждый отзыв по таймеру →
  распухание. `reviews.id` **меняется** при каждом изменении состояния (та же болезнь, что у отвергнутой
  A-i для confirmed_sales: якорь-id перестаёт быть стабильным).
- **Соответствие «один механизм»:** высокое (всё — append-only супersede).
- **Риск:** резолвер головы должен отличать авторскую правку от смены модерационного состояния (actor
  тогда = модератор → семантически «модератор написал новую версию отзыва»); смешивает две разные природы
  в одной цепочке.

### Вариант β — вынести `moderation_status`/`is_visible` в мутабельную companion `review_states` (РЕКОМЕНДУЮ)
```sql
-- FORM/DORMANT: mutable per-review moderation + visibility state, symmetric with A-iii and reputation_aggregates.
CREATE TABLE review_states (
    review_id         UUID PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
    moderation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    is_visible        BOOLEAN     NOT NULL DEFAULT FALSE,
    moderated_at      TIMESTAMPTZ,
    actor_id             UUID REFERENCES users(id) ON DELETE SET NULL,   -- WHO moved the state (moderator/agent)
    actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_review_states_mod_status  CHECK (moderation_status IN
        ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED')),
    CONSTRAINT chk_review_states_actor_ptype CHECK (actor_principal_type IN ('HUMAN','AGENT'))
);
CREATE TRIGGER trg_review_states_updated_at
    BEFORE UPDATE ON review_states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- and drop the two mutable-by-design columns from the immutable reviews:
ALTER TABLE reviews DROP COLUMN moderation_status;   -- moves to review_states
ALTER TABLE reviews DROP COLUMN is_visible;          -- moves to review_states
-- chk_reviews_moderation_status уходит вместе с колонкой; idx_reviews_subject_market предикат
-- переносится на join к review_states (в поведенческом слайсе) либо на материализованную проекцию
```
- **Цена:** +1 таблица (реформа на пустых → одна миграция). `reviews.id` **стабилен** (состояние висит на
  нём). Чтение = join. Модерация и double-blind раскрытие — естественные UPDATE (то, чем они и являются).
- **Соответствие «один механизм»:** это ТОТ ЖЕ принцип, что A-iii (неизменяемый факт + мутабельная
  companion). Если держатель берёт A-iii для развилки A, β делает канон однородным: `reviews`=факт,
  `review_states`=состояние, `moderation_decisions`=решение, `reputation_aggregates`=кэш — четыре роли,
  четыре формы, ни одной подмены.
- **Риск:** две таблицы на отзыв; приёмка = две таблицы вместо одной.

**Ортогональность β и B-ii:** это НЕ конкуренты. B-ii = цепочка авторских правок неизменяемого СОДЕРЖАНИЯ
(rating/body). β = операторское/планировщиковое СОСТОЯНИЕ каждой строки. Композируются: `review_states`
ключуется на `review_id`; для показа берётся состояние головы цепочки. Держателю — α/β = Q4.

### Связь развилок A и B (важно)
A-iii и B-iv-β — **одна и та же архитектурная ветка** (факт+состояние), применённая к продажам и отзывам.
Если держатель выбирает A-iii, β делает канон последовательным. Если выбрал бы A-ii (отвергнута лейном),
β стал бы внутренне непоследовательным. **Развилки стоит решать одним движением.**

---

## §Р-9 — drift-гейт односторонен (буквальный механизм держателя НЕ подходит)

### Почему «Path 2 = пустая БД + только migrations/*.sql» НЕ исполнимо (сверено)
Джоб `migration-drift` (`.github/workflows/ci.yml:132-140`): **обе** дорожки стартуют с `database_schema.sql`
(Path 1 = только он; Path 2 = он же + replay миграций). Любое изменение канона попадает в ОБЕ стороны diff
и вычитается → гейт ловит только то, что миграции ДОБАВЛЯЮТ сверх канона, и слеп к DDL, живущему только в
каноне (доказано reviewer-qa Р-9: `audit_log ADD COLUMN` в канон → GREEN).

Буквальная замена держателя не работает в модели ADR-0007: **миграция `0001` = `schema_audit_remediation`
ALTER-ит УЖЕ существующую базу** (заголовок дословно: «bring an existing pre-audit baseline up to the
corrected database_schema.sql»; тело: `ALTER TABLE animals DROP CONSTRAINT …`, `ALTER TABLE
organization_users ADD CONSTRAINT …`). Миграции — инкрементальные дельты НА канон, НЕ самодостаточный
bootstrap от пустой БД. `replay migrations на пустую` упадёт на первом же `ALTER TABLE animals …` (таблицы
`animals` нет). Пустая-БД-дорожка неисполнима без «нулевого» базиса.

### Замена — модель-соответствующий фикс (две части, слоями)

**Р9-A (структурная, идеал) — замороженный pre-audit baseline как Path-0 + независимая реконструкция.**
Зафиксировать pre-audit baseline (состояние БД ДО `0001`) отдельной коммит-фикстурой
`test/fixtures/baseline_pre_audit.sql`. Тогда:
- Path 1 = `database_schema.sql` (канон);
- Path 2 = `baseline_pre_audit.sql` + replay ВСЕХ миграций `0001..N` — **независимая реконструкция**,
  которая НЕ читает `database_schema.sql`.
- diff Path1↔Path2 становится **двусторонним по построению**: мутация в канон попадает только в Path 1 → RED.
- **Цена:** восстановить baseline из git-истории (`database_schema.sql` на коммите перед появлением
  `migrations/`) и **заморозить навсегда** (регенерация из канона вернёт односторонность). Низкочастотный
  исторический артефакт. Осуществимость восстановления — Q7.

**Р9-B (дешёвая, немедленная) — реестр именованных инвариантов + позитивные assert-ы существования.**
CI-шаг против ПРИМЕНЁННОЙ схемы: по НАЗВАННОМУ списку критичных ограничений/индексов/триггеров
ассертить существование (`SELECT 1 FROM pg_constraint/pg_indexes/pg_trigger WHERE conname/indexname/tgname = …`).
Удаление именованного инварианта из канона **и** миграции → assert RED (список независим от обеих дорожек).
Это ЗАКРЫВАЕТ и Р-9 (канон-only удаление), и Р-10 (см. ниже) одним механизмом.
- **Цена:** вести реестр (риск «рукописный список теряет пункты» — `lesson-handwritten-worklist-loses-items`).
  Смягчение: мета-гейт «каждый новый `CONSTRAINT chk_*`/`uq_*`/`trg_*` в `database_schema.sql` обязан
  присутствовать в реестре» (греп канона ⊆ реестр). Governance — Q8.

**Рекомендация:** начать с **Р9-B** (дёшево, закрывает Р-9 и Р-10 сразу, не трогает bootstrap ADR-0007);
довести до **Р9-A** (истинная двусторонность), если baseline восстановим. Держателю прямо: **его буквальный
механизм неисполним по причине выше; Р9-A — его дух, сделанный исполнимым.**

---

## §Р-10 — БД-инвариантные e2e меряют dev-БД, не артефакты

### Что сломано (сверено)
`reputation-storage.e2e` подключается через `PrismaService` к **живой dev-БД** (`db:sync` = `prisma db pull`
= introspect-only, схему не пересобирает). reviewer-qa доказал: удаление `uq_reviews_current_per_direction`
из канона+миграции → 16/16 зелено + drift GREEN, потому что индекс всё ещё физически в dev-БД. Класс —
ВСЕ БД-инвариантные e2e (append-only ×5, именованные CHECK/UNIQUE/GENERATED, ≈40 ассертов).

### Фикс (две части)
**Р10-A — поднимать БД-инвариантные e2e на throwaway-схеме из АРТЕФАКТА.** Suite строит выделенную
throwaway-БД применением `database_schema.sql` (в CI переиспользовать уже существующую машинерию джоба
`migration-drift`: `CREATE DATABASE` + `psql -f database_schema.sql`), а не dev-БД, которую интроспектил
`db:sync`. Тогда удаление констрейнта из канона → throwaway его лишена → негативный INSERT-тест видит
принятую вставку → RED.

**Р10-B — выделенный `schema-invariants.e2e` по НАЗВАННОМУ реестру** (тот же реестр, что Р9-B):
`pg_constraint`/`pg_indexes`/`pg_trigger` by name → assert exists. Надёжнее, чем полагаться на каждый
негатив-INSERT (который может молча измерять dev-БД). Реестр — общий спинной хребет Р-9 и Р-10.

**Рекомендация:** обе. Р10-A чинит поведенческие негатив-тесты (мерят артефакт), Р10-B/Р9-B —
авторитетный gate существования. Единый реестр именованных инвариантов = общий механизм для CI и e2e.

---

## §СПИСОК МУТАЦИЙ (приёмка держателя — обязательная часть)

Закон `lesson-axis-must-catch-its-own-mutation`: для каждого фикса — мутация, которая ОБЯЗАНА его покраснить,
словами оси. **«свод покраснел» ≠ «ось работает»**: краснеть должна ИМЕННО целевая ось.

| # | Мутация (словами оси) | Что ОБЯЗАНО покраснеть | Механизм фикса |
|---|---|---|---|
| M-1 | удалить `uq_reviews_root_per_direction` / VIEW `reviews_current` (новый current-механизм) из артефактов | (a) `schema-invariants.e2e` — assert `pg_indexes … 'uq_reviews_root_per_direction'` / `pg_views … 'reviews_current'` RED; (b) поведенческий: два корня для одной `(sale,direction)` против throwaway-из-канона → ожидался 23505, теперь оба прошли → RED | Р10-A + Р10-B |
| M-2 | мутация в **КАНОН** `database_schema.sql`: ADD-в-канон (`audit_log ADD COLUMN`) | Р9-A: Path 1 несёт, Path 2 (baseline+миграции) — нет → diff RED. Р9-B (для REMOVE-из-обоих): существование-assert RED | Р9-A (ADD) + Р9-B (REMOVE) |
| M-3 | удалить `uq_reviews_supersedes` (новый UNIQUE на обратном указателе) из артефактов | (a) `schema-invariants.e2e` существование-assert RED; (b) поведенческий: две строки, супersede-ящие одного предка (раздвоение), против throwaway-из-канона → ожидался 23505 → RED | Р10-A + Р10-B |
| M-4 | ослабить append-only `confirmed_sales` (заменить `trg_confirmed_sales_immutable` на no-op / дроп в каноне+миграции) | негатив UPDATE/DELETE `confirmed-sales.e2e:313/314` против throwaway-из-канона → вставка/апдейт прошли → RED (сегодня, Р-10, зелено на dev-БД) | Р10-A (+ Р10-B: existence `pg_trigger 'trg_confirmed_sales_immutable'`) |
| M-5 | ослабить append-only `sale_confirmations`? **НЕТ** — она мутабельна по замыслу | (контроль-наоборот) `review_states`/`sale_confirmations` ДОЛЖНЫ пропускать UPDATE — позитивный тест мутабельности (как `reputation-storage.e2e:207` для `reputation_aggregates`) | — |

### 2 декоративные оси (reviewer-qa ось 13) + Б2-юнит — поимённо + как переделать

| Ось | Файл:строка | Почему декоративна | Как переделать, чтобы мерила предмет |
|---|---|---|---|
| **T4** (reviewer-qa ось 13) | `reputation-storage.e2e-spec.ts:95` («second head … rejected») + `database_schema.sql:737` | Меряет живую dev-БД, где индекс есть; вынесен из канона+миграции → 16/16 зелено + drift GREEN. Плюс сам инвариант, что он утверждает (`superseded_by_id IS NULL` head), под B-ii исчезает | Переписать под новую модель B-ii: (1) suite поднимается на throwaway-из-канона (Р10-A); (2) тест утверждает `uq_reviews_root_per_direction` — «второй КОРЕНЬ на (sale,direction) отклонён» + отдельный «второй наследник предка (`uq_reviews_supersedes`) отклонён»; (3) existence-assert обоих индексов в `schema-invariants.e2e` |
| **T5 / H4-3** (reviewer-qa ось 13) | `saved-search-match.e2e-spec.ts:139,228` | `countFor` = `count WHERE idempotency_key = '<канонический литерал>'`, а на колонке `uq_notification_idempotency UNIQUE` → результат ∈ {0,1} ПО ПОСТРОЕНИЮ. `toBe(1)` физически не видит дубликат (ловит только отсутствие). Дубль поймал соседний H4-17, появившийся только в HEAD | Критерий на величину, которая МОЖЕТ быть ≥2: `count WHERE user_id=<owner> AND template_id=<saved_search_matched> AND created_at within window` (или по `template_id`+`user_id`), НЕ по `idempotency_key`. Мутант T5b (ключ канонический на 1-й доставке, случайный на повторах) обязан дать `count=2` → RED |
| **Б2-юнит** (backend-engineer ось 1/13) | `notification-writer.service.spec.ts:48,56` | Фикстура `{ru:'Щенок', en:'Puppy'}` — ОБЕ локали заполнены; fallback проверяется языком `'fr'`, ключа которого в карте нет. Боевой `localizedTitle()` (`saved-search-match.consumer.ts:282`) на отсутствующей локали возвращает `''` (не `undefined`), а `??` (`notification-writer.service.ts:117`) не откатывается на пустой строке → форму «одна локаль пустая» производитель порождает, а тест её НЕ мерит | Фикстура = en-only `{en:'Puppy', ru:''}` (что производитель реально эмитит для en-only объявления) + получатель `preferred_language='ru'` → assert rendered title непустой (`'Puppy'`). Мерит истинный путь fallback-на-пустой-строке. (Починка предмета — Б2: `locale()`→`undefined` при отсутствии, ЛИБО `byLang[language] || byLang.ru || ''`) |

---

## §разбивка на 2 коммита (гранулярность держателя, откатываемы порознь)

### Коммит-1 — СХЕМА (A-iii + B-ii + B-iv + сопутствующее); доказывается мутациями В СХЕМУ
**Пути:**
- `database_schema.sql` — новые `sale_confirmations`, `review_states` (β); дельты `confirmed_sales`, `reviews`; VIEW `reviews_current`
- `migrations/YYYYMMDD_00NN_*.sql` — идемпотентная миграция (на пустых → без данных)
- `ZooLink_ERD.mmd`, `docs/03-architecture/data-model.md` — новые таблицы/связи
- `docs/04-decisions/0038-*.md` (Amendment §4), `0039-*.md` (Amendment §3), `0020-*.md`/`0021-*.md` (Status→Accepted, C-3)
- `docs/specs/18-reputation.md` — §4/§5 переписаны под раздельную модель (C-2)
- `backend/prisma/schema.prisma` — introspect (`db:sync`); табличный счёт `ZooLink/CLAUDE.md` (41→43/44 по β)
- **импл-нота (не в этом файле):** `transfer.service` перестаёт писать ушедшие колонки `confirmed_sales`

### Коммит-2 — ГЕЙТЫ (Р-9/Р-10 + 3 переделанные оси); доказывается мутациями В ГЕЙТ
**Пути:**
- `.github/workflows/ci.yml` — джоб `migration-drift`: Р9-A (Path-0 baseline) и/или Р9-B (реестр-assert); новый шаг/джоб `schema-invariants`
- `test/fixtures/baseline_pre_audit.sql` (Р9-A, если восстановим)
- `scripts/schema-invariants.sh` или `backend/test/schema-invariants.e2e-spec.ts` (Р9-B/Р10-B — общий реестр)
- `backend/test/jest-e2e` setup — БД-инвариантные suite поднимаются на throwaway-из-канона (Р10-A)
- `backend/test/reputation-storage.e2e-spec.ts` (T4), `saved-search-match.e2e-spec.ts` (T5), `notification-writer.service.spec.ts` (Б2) — переделаны

**Раздельность отката:** коммит-1 = схема/миграции/доки; коммит-2 = CI/тесты. Реверт одного не ломает
другой (схема без гейта = валидная схема; гейт без схемы = гейтит текущую схему). Схема доказывается
мутациями в СХЕМУ (M-1…M-4 предметно), гейты — мутациями в ГЕЙТ (M-2 + декоративные оси).

---

## §Открытые вопросы держателю (не решено самовольно)

- **Q1 — A-iii × partial-unique (C-1):** под A-iii `confirmed_sales` держит только CONFIRMED-факты →
  полный `UNIQUE(ownership_transfer_id)` ОСТАЁТСЯ верным (подтверждённая продажа-по-transfer постоянна,
  её не заменяют), а семантика «одна живая, отменённая заменяема» переезжает на `sale_confirmations`
  (`uq_sale_conf_live_per_listing`, ключ = `listing_id`, т.к. markSold listing-якорный, `ownership_transfer_id`
  NULL). **Применять partial-unique к самому `confirmed_sales` под A-iii, вероятно, не нужно.** Подтвердите:
  оставляем `uq_confirmed_sales_transfer` полным, «заменяемость» живёт на companion?
- **Q2 — `confirmed_sales.status`:** дропнуть колонку (существование строки = CONFIRMED, чище) ИЛИ оставить
  с суженным `CHECK (status='CONFIRMED')` (меньше диф, аудиторский маркёр — рекомендую)?
- **Q3 — диспут ПОСЛЕ подтверждения (ADR-0040 §16):** должен ли `sale_confirmations` также ссылаться на
  `confirmed_sale_id`, чтобы CONFIRMED-факт мог позже уйти в DISPUTED в мутабельной таблице (companion
  покрывает и до-, и пост-подтверждение), или диспут = отдельный механизм (подтип `content_report`,
  ADR-0040)? Влияет на то, ключует ли companion factа.
- **Q4 — B-iv: α vs β.** Рекомендую β (стабильный `reviews.id`, симметрия с A-iii; α churn-ит id и
  смешивает авторскую правку с операторским состоянием). Подтвердите.
- **Q5 — B-ii строже, чем `moderation_decisions`:** reviews получает `UNIQUE(supersedes_review_id)`
  (линейная цепочка), у `moderation_decisions` его нет (ветвление допустимо). Осознанное расхождение
  (правка отзыва линейна, оверрайд решения может ветвиться) — подтвердить?
- **Q6 — «одна текущая на (sale,direction)» как DB-инвариант:** моя модель сохраняет его через
  `uq_reviews_root_per_direction` (сильнее, чем сводка `architect.md §5.3`, где он уходил в приложение).
  Оставляем DB-инвариантом?
- **Q7 — Р9-A baseline:** авторизовать devops восстановить pre-0001 baseline из git-истории и заморозить
  фикстурой? Если невосстановим — Р9-B в одиночку закрывает наблюдаемую дыру; приемлемо как MVP-фикс?
- **Q8 — governance реестра инвариантов:** рукописный критичный список ИЛИ мета-гейт «каждый новый
  `chk_*`/`uq_*`/`trg_*` в каноне ⊆ реестр» (защита от `lesson-handwritten-worklist-loses-items`)?
```
