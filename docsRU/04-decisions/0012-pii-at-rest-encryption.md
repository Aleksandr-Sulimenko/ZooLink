# ADR-0012: Шифрование PII в покое (ФЗ-152)

**Status**: Accepted
**Date**: 2026-06-24

> Примечание о фазировании (IMPLEMENTATION_PLAYBOOK §5): этот ADR фиксирует сейчас **необратимую форму**
> (форма колонок, крипто-абстракция, env ключа, blind-index для lookup-колонок); тяжёлое **поведение**
> (раскатка пер-колоночного field-encryption + подключение RF-KMS) застейджено за этой формой, так что
> переписывание позже не вынуждается.
> Тройки **ЧТО / ПОЧЕМУ / ПОЧЕМУ ТАК ЛУЧШЕ** даны по каждому решению ниже.

## Context and Problem Statement

ФЗ-152 и `security/security_specification.md` требуют **шифрования PII в покое** («Data at Rest:
TDE/filesystem», «Sensitive Data Encryption: … email addresses», «field-level encryption for highly
sensitive PII», «database encryption with separate key management»). Сегодня инвентарь PII
(`data-governance.md §1`) хранится **в открытом виде** в PostgreSQL: `users.full_name`, `users.email`,
`users.contact_phone`, `users.contact_telegram`, `users.avatar_url`; `organizations.{inn,kpp,email,phone,
address}`; `notification_logs.{recipient,content}`. Единственный уже защищённый идентификатор —
`users.phone_hash` (детерминированный **HMAC-SHA256**, ADR-0011/spec 01 — необратимый lookup-индекс, не
открытый текст). Ретрофит шифрования после запуска означает миграцию типов колонок, backfill шифротекста
и переписывание каждого пути чтения/записи — ровно тот триггер «дешевле менять во время разработки».

Два сквозных ограничения делают это нетривиальным:
- **Отправляемость:** `email` должен оставаться обратимым (восстановление шлёт OTP **на** адрес) — он не
  может быть односторонним хешем как `phone_hash`.
- **Поиск:** `email` запрашивается при восстановлении аккаунта (`/auth/recover/email/*`) — рандомизированный
  шифротекст не ищется, поэтому нужен **детерминированный blind-index** для пути поиска.

## Decision Drivers

- **Соответствие ФЗ-152 / security_spec:** PII защищён в покое, управление ключами отделено от данных.
- **Anti-rewrite (§5):** форма колонок + крипто-шов + абстракция ключа необратимы → решаем сейчас.
- **Объём MVP (ADR-0009):** без тяжёлой инфры в MVP; управление ключами должно иметь **swap-point** на RF-KMS
  (паттерн ADR-0008) без затрагивания доменного кода.
- **ADR-0007 (SQL-канон + Prisma introspect):** выбранный механизм должен переживать `prisma db pull`
  (интроспекцию) и SQL-first workflow.
- **Сосуществование со стиранием (ADR-0011 / data-governance):** не должно конфликтовать с tombstoning
  `erase_user` или с HMAC-моделью `phone_hash`.

## Considered Options

### Option 1: Только уровень хранилища (TDE / зашифрованный том)
Шифровать том БД / файловую систему; без изменений приложения.

Pros:
- Ноль кода; покрывает все колонки + бэкапы грубо; дешёвый немедленный baseline.

Cons:
- Защищает только от украденных дисков — скомпрометированное соединение с БД / SQL-дамп всё равно раскрывает PII в открытом виде.
- security_spec явно также требует **field-level** шифрование для крайне чувствительного PII → одного этого недостаточно.

### Option 2: Пер-колоночное шифрование `pgcrypto` (в БД)
`pgp_sym_encrypt`/`decrypt` в SQL с ключом, передаваемым по запросу.

Pros:
- В БД, минимум кода приложения; стандартное расширение PG.

Cons:
- Ключ ездит в тексте SQL → высокий риск утечки в логи запросов / `pg_stat_statements`.
- Управление ключами живёт в слое БД (против «separate key management»).
- Ломает типизацию Prisma (bytea), поиск и читаемость SQL-канона; неуклюжий swap на RF-KMS.

### Option 3: Envelope-шифрование на уровне приложения + детерминированный blind-index (ВЫБРАНО)
Порт `CryptoService` в приложении шифрует/дешифрует PII (AES-256-GCM, рандомный IV на запись) с помощью
**data key**, обёрнутого **master key**; master key приходит из локального env-секрета сейчас и из
**RF-KMS** (Yandex/VK Cloud KMS) в production через адаптер в стиле ADR-0008. Колонки, требующие поиска
(`email`), дополнительно несут детерминированный **blind-index** (HMAC-SHA256, тот же паттерн pepper, что и
`phone_hash`).

Pros:
- Ключ никогда не попадает в SQL или логи; отдельное управление ключами; чистый swap-point на RF-KMS (поведение застейджено).
- Пер-колоночный контроль; рандомизированный шифротекст для отображаемого PII, blind-index только там, где требуется поиск.
- Переживает Prisma introspect (шифротекст хранится как `text`/`bytea`, маппится приложением); сосуществует с `erase_user`
  (tombstone/NULL перекрывает шифротекст) и `phone_hash` (без изменений).

Cons:
- Больше подвижных частей (обёртка ключа, ротация) — смягчается стейджингом поведения за формой.
- Дешифрование происходит в приложении → нужно держать PII вне логов (уже предписано `nfr/observability.md`).

### Option 4: RF-KMS envelope сейчас (полностью)
Подключить Yandex/VK KMS немедленно для всего PII.

Pros: сильнейшее управление ключами с первого дня.
Cons: тяжёлая инфра в MVP (нарушение ADR-0009); не нужно до реальных пользовательских данных → отложить **поведение**, сохранить **шов**.

## Decision

Принять **двухуровневую модель**:

- **Tier 1 — хранилище в покое (ops, baseline MVP):** зашифрованный том БД / файловая система (TDE-эквивалент) +
  SSE на объектном хранилище (Yandex Object Storage SSE, уже ADR-0008) + зашифрованные бэкапы. Контроль devops,
  без изменения схемы; немедленно удовлетворяет грубое требование «data at rest».

- **Tier 2 — пер-полевое шифрование на уровне приложения (Option 3), ФОРМА сейчас / раскатка застейджена:** порт
  `CryptoService` (AES-256-GCM envelope) с **адаптером LocalMasterKey** (env `PII_ENCRYPTION_KEY` ≥ 32 байт,
  fail-fast в prod) сейчас и **адаптером RF-KMS** (Yandex/VK KMS) как отложенный production swap-point
  (расширяет матрицу провайдеров ADR-0008 строкой **KMS**). Field-encrypt высокочувствительного обратимого
  PII; добавить детерминированный **blind-index** только для lookup-колонок.

**Обработка колонок (нормативно):**

| Column(s) | Treatment | Lookup? |
|---|---|---|
| `users.full_name`, `users.contact_phone`, `users.contact_telegram`, `users.avatar_url` | field-encrypt (randomized) | no |
| `users.email` | field-encrypt (reversible, sendable) **+ `email_blind_index` (HMAC)** | yes (recovery) |
| `users.phone_hash` | **unchanged** (already HMAC, non-reversible) | yes |
| `organizations.{inn,kpp,email,phone,address}` | field-encrypt (randomized) | no (MVP) |
| `notification_logs.{recipient,content}` | drop/mask per data-governance, else field-encrypt | no |

**Взаимодействие со стиранием:** `erase_user` tombstone'ит/NULL'ит эти колонки как сегодня — tombstone
перекрывает любой шифротекст; нечего дешифровать после стирания. Освобождение `phone_hash` без изменений.

**ЧТО:** envelope field-encryption на уровне приложения + blind-index, за портом с swap-point local→KMS;
storage-tier как грубый baseline. **ПОЧЕМУ:** держит ключи вне SQL/логов и отдельно от данных
(security_spec), даёт пер-колоночный контроль, и форма колонок/абстракции и есть необратимый артефакт.
**ПОЧЕМУ ТАК ЛУЧШЕ:** соответствует ФЗ-152 без затаскивания KMS-инфры в MVP (ADR-0009); swap на RF-KMS —
отложенный адаптер, а не переписывание; чисто сосуществует с `erase_user` и `phone_hash`.

## Consequences

### Positive
- PII в покое защищён двумя независимыми слоями; ключи управляются отдельно и ротируемы.
- Необратимая форма (колонки + `CryptoService` + env ключа + email blind-index) зафиксирована сейчас → нет позднего переписывания схемы/пути.
- RF-KMS — drop-in адаптер, когда production того потребует (паттерн ADR-0008), поведение gated до тех пор.

### Negative
- Field-зашифрованные колонки не запрашиваются напрямую (кроме как через blind-index) — приемлемо; в MVP поиск нужен только `email`.
- Приложение дешифрует при чтении → нужна строгая дисциплина маскирования логов (уже предписано).

### Neutral
- Tier-1 storage-шифрование — забота деплоя (devops), отслеживается отдельно от этого ADR формы схемы.
- Полная раскатка field-encryption + подключение KMS застейджены; MVP может выйти с формой на месте и активным Tier-1.

## Implementation Notes

**Спецификация миграции (для backend — ФОРМА сейчас; заполнение/раскатка застейджены):**
- Добавить `users.email_blind_index VARCHAR(64)` (детерминированный HMAC-SHA256(lower(email), pepper)); unique
  partial index `WHERE email_blind_index IS NOT NULL`; lookup восстановления использует его (зеркало `phone_hash`).
- Field-зашифрованные колонки сохраняют текущий тип для MVP (Tier-1 их покрывает); когда раскатка Tier-2
  приземлится, хранить шифротекст в той же колонке (base64/`text`) или в парной `*_enc`-колонке — **путь
  чтения/записи идёт через `CryptoService`**, так что форма имени колонки — единственное обязательство схемы сейчас.
- Порт `CryptoService` в `backend/src/lib/crypto/` с `LocalMasterKeyAdapter` (env) + заглушкой
  `KmsMasterKeyAdapter` (отложено); AES-256-GCM, IV на запись, версионированный id ключа для ротации.
- env: `PII_ENCRYPTION_KEY` (≥32, опционален в dev/test, **обязателен в prod** через `validateEnv()` — тот же
  паттерн, что `AGENT_SERVICE_SIGNING_SECRET`, ADR-0011); плейсхолдер в `.env.example`; будущий swap `KMS_*`.
- DB-workflow: `database_schema.sql` + идемпотентная миграция + ERD + `data-model.md` + счётчики; live-PG ×2 +
  негативные тесты (уникальность blind-index; стирание перекрывает шифротекст); EN↔RU.
- Расширить матрицу провайдеров ADR-0008 строкой возможности **KMS** (Yandex KMS / VK Cloud KMS; dev = локальный ключ).

**Вне объёма (отложенное поведение):** массовый backfill/шифрование существующих строк, реализация адаптера KMS,
пер-колоночные jobs ротации — всё за формой выше.

## Related Decisions
- [ADR-0011](0011-agent-principal-actor-model.md): паттерн env-секрет + fail-fast-в-prod переиспользован для `PII_ENCRYPTION_KEY`; модель erase/override.
- [ADR-0008](0008-rf-provider-matrix.md): RF-абстракция провайдеров; этот ADR добавляет строку swap-point KMS.
- [ADR-0009](0009-mvp-vs-target-architecture.md): граница инфры MVP — поведение KMS отложено, форма сохранена.
- [ADR-0007](0007-orm-strategy.md): SQL-канон + Prisma introspect — уровень приложения держит типы чистыми.

## References
- `docs/specs/data-governance.md` §1 (инвентарь PII), §erase_user
- `docs/specs/security/security_specification.md` (data-at-rest, field-level encryption, key management)
- `docs/specs/01-identity-domain.md` (phone_hash HMAC; email recovery lookup)
- 🌐 EN canon: `docs/04-decisions/0012-pii-at-rest-encryption.md`
