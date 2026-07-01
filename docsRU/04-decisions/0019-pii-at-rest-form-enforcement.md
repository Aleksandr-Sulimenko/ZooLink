# ADR-0019: ПДн в покое — реализовать форму ADR-0012 сейчас (blind-index + crypto-шов), раскатку field-encryption застейджить

**Status**: Proposed — ожидает sign-off at-rest launch-floor от security+legal (владелец рассмотрел Q1–Q6 2026-07-01)
**Date**: 2026-07-01
**Amends**: [ADR-0012](0012-pii-at-rest-encryption.md) — **обеспечивает и упорядочивает по времени уже решённый ADR-0012 сплит «форма сейчас / раскатка застейджена»; НЕ supersedes и не меняет его решение.** ADR-0012 остаётся Accepted.
**Relates to**: [ADR-0017](0017-rf-data-residency.md) (резидентность дополняет защиту в покое), [ADR-0011](0011-agent-principal-actor-model.md) (прецедент `phone_hash` HMAC), Legal launch-compliance **A-items** (`docs/legal/launch-compliance-checklist.md`).
**Needs sign-off**: security + legal (является ли storage-level baseline приемлемым ФЗ-152 at-rest порогом на запуске?) — **владелец ратифицирует**.

> **ЧТО** — ADR-0012 уже решил, что *форма* (форма колонок, шов `CryptoService`, детерминированный **blind-index** для lookup-пути email, swap-point env-ключа/KMS) строится **сейчас**, а тяжёлая *пер-колоночная раскатка field-encryption* стейджится за ней. Аудит нашёл, что **форма так и не построена** (нет `CryptoService`, нет blind-index; `email`/`full_name`/`contact_*` в plaintext; восстановление ищет по plaintext email). Этот ADR разрешает пробел: **(1)** предписать форму blind-index + crypto-шов как **go-live-блокирующую** (это дешёвый, необратимый кусок, привязанный к email-восстановлению); **(2)** добавить **storage-level/volume-шифрование baseline** как ФЗ-152 at-rest порог на запуске (devops); **(3)** формально застейджить массовую пер-колоночную раскатку field-encryption за швом, отслеживаемую в backlog.
>
> **ПОЧЕМУ** — Blind-index это необратимый кусок: как только аккаунты существуют с plaintext-only email и `/auth/recover/email/*` запрашивает plaintext, добавление детерминированного blind-index позже значит **backfill HMAC по каждому email И переписывание read-пути восстановления** — ровно тот ретрофит, ради избегания которого писался ADR-0012, и он растёт с каждым аккаунтом. Наоборот, полная пер-колоночная *раскатка* field-encryption по-настоящему стейджима (read/write-адаптеры могут шифровать колонку-за-колонкой за швом). Поэтому правильное разрешение — **не** пере-решать ADR-0012, а **обеспечить его форму и правильно упорядочить** против go-live.
>
> **ПОЧЕМУ ТАК ЛУЧШЕ для всего проекта** — Соблюдает правило фазирования §5, которое сам ADR-0012 призвал (форма-сейчас, если отсрочка вынуждает rewrite; поведение застейджено), вместо того чтобы молча дать «форме сейчас» соскользнуть в «никогда». Даёт legal защитимый ФЗ-152 at-rest ответ на запуске (storage-level baseline + blind-index, защищающий lookup-колонку), не блокируя запуск полной раскаткой field-encryption, и держит email-восстановление корректным с первого аккаунта. Компонуется с ADR-0017 (резидентность = где; шифрование = как-защищено) и переиспользует прецедент `phone_hash` HMAC (ADR-0011).

## Context and Problem Statement

ADR-0012 (Accepted) решил ПДн-в-покое с чётким §5 сплитом: **форма сейчас** = форма колонок + абстракция `CryptoService` + **детерминированный blind-index** для lookup'а `email` (т.к. восстановление должно искать по email, а рандомизированный ciphertext не искабелен) + env-ключ с RF-KMS swap-point; **раскатка застейджена** = пер-колоночное field-encryption за этим швом. Аудит нашёл, что **ничего из формы не выпущено**: нет `CryptoService`/blind-index, `email`/`full_name`/`contact_*`/org-поля в plaintext, и восстановление аккаунта запрашивает plaintext `email`. Между тем ФЗ-152 + `security_specification.md` требуют ПДн защищёнными в покое, а ADR-0017 теперь пинит резидентность.

Два разных куска с разной обратимостью:
- **Blind-index + crypto-шов (форма)** — *необратим-при-отсрочке*. Plaintext-only email + plaintext lookup восстановления нельзя чисто отретрофитить под blind-index без backfill HMAC по всем строкам и переписывания пути восстановления; стоимость растёт на аккаунт.
- **Пер-колоночное field-encryption (раскатка)** — *стейджима*. Колонка-за-колонкой за швом; storage-level шифрование может держать at-rest порог в промежутке.

Выбор deliverable: **amend-с-формальной-отсрочкой (трекать в backlog)** vs **предписать форму blind-index сейчас**.

## Decision Drivers

1. **Необратимость lookup-пути** — blind-index по `email` это кусок, болезненный для ретрофита, как только аккаунты существуют (сильнейший драйвер; зеркалит собственный анти-rewrite rationale ADR-0012).
2. **ФЗ-152 at-rest требование на запуске** (legal A-items) — *какая-то* at-rest защита должна существовать на go-live, а не «позже».
3. **Не пере-решать здравый ADR** — сплит форма/раскатка ADR-0012 верен; провал — нереализация, поэтому обеспечить + упорядочить, не supersede.
4. **Email должен оставаться обратимым и искабельным** — восстановление шлёт OTP *на* адрес (не one-way-хэш) И ищет его → нужен ciphertext + детерминированный blind-index. (ADR-0012 уже это обосновал.)
5. **Переиспользовать прецедент `phone_hash`** (ADR-0011) — паттерн детерминированного HMAC blind-index уже в кодовой базе.
6. **Scope MVP (ADR-0009)** — никакой тяжёлой KMS-инфры сейчас; storage-level baseline + шов с KMS swap-point.

## Considered Options

### Option A: Amend ADR-0012 формальной отсрочкой — принять plaintext ПДн в покое на запуске как задокументированный, time-boxed риск
Понизить «форму сейчас» до «трекаемого backlog»; выпустить с plaintext ПДн + plaintext восстановлением; зашифровать позже.

Pros:
- Быстрейший путь к запуску; ноль crypto-работы сейчас.

Cons:
- **Ретрофит blind-index позже это ровно тот rewrite, который ADR-0012 запретил**, и backfill растёт на аккаунт.
- Plaintext ПДн в покое трудно защитить по ФЗ-152 / `security_spec` на запуске (юридическая экспозиция; дамп БД раскрывает всё).
- Пере-решает здравый ADR в неверном направлении под нереализацию.

### Option B: Предписать форму blind-index + crypto-шов сейчас; storage-level baseline на запуске; застейджить раскатку field-encryption (Выбрано)
Построить необратимую форму до запуска (blind-index по `email`, шов `CryptoService`, swap-point env-ключа/KMS); включить storage-level/volume-шифрование для ФЗ-152 at-rest порога; застейджить пер-колоночное field-encryption за швом, трекать в backlog.

Pros:
- Необратимый кусок корректен с аккаунта №1 — никакого будущего backfill/rewrite пути восстановления.
- Storage-level baseline даёт защитимый ФЗ-152 at-rest ответ на запуске без блокировки на полной раскатке.
- Соблюдает собственный §5 сплит ADR-0012; переиспользует прецедент `phone_hash` HMAC.
- Раскатка field-encryption идёт колонка-за-колонкой за швом в безопасном темпе.

Cons:
- Какая-то crypto-шов работа до запуска (ограниченная: шов + одна blind-index колонка + storage-шифрование).
- Storage-level baseline сам по себе может не удовлетворить «field-level для высокочувствительных ПДн» из `security_spec` — нужен sign-off security+legal, приемлемый ли это *launch floor* с раскаткой field позже.

## Decision

Принимаем **Option B**. ADR-0012 стоит; этот ADR обеспечивает и упорядочивает его:

1. **Go-live-блокирующая форма (построить до запуска):**
   - **Шов `CryptoService`** (абстракция encrypt/decrypt) с **env-ключом + RF-KMS swap-point** (никакого ключа в SQL-тексте — Option-2 ADR-0012 отклонён).
   - **Детерминированный blind-index по `email`** (HMAC, прецедент `phone_hash`), чтобы `/auth/recover/email/*` искал по индексу, а не по plaintext.
   - `email` хранится как **обратимый ciphertext** (отправляемый) + его blind-index; read-путь восстановления использует индекс.
2. **ФЗ-152 at-rest baseline на запуске:** включить **storage-level / encrypted-volume** шифрование для PII-несущих хранилищ (devops) — at-rest порог, компонующийся с резидентностью ADR-0017.
3. **Застейдженная раскатка (трекается в backlog, за швом):** пер-колоночное field-encryption для остальных ПДн (`full_name`, `contact_*`, `avatar_url`, `organizations.{inn,kpp,email,phone,address}`, получатель/содержимое уведомлений) раскатывается колонка-за-колонкой за `CryptoService` — без rewrite схемы/контракта, т.к. шов существует.
4. **Никакого supersession.** Решение ADR-0012 без изменений; этот ADR чинит пробел реализации и упорядочивает по времени форму-vs-раскатку против go-live.
5. **Остаточный sign-off (владелец ратифицирует):** **security + legal** подтверждают, является ли storage-level baseline + blind-index приемлемым ФЗ-152 / `security_spec` at-rest порогом для запуска с раскаткой field позже, или конкретные «высокочувствительные» колонки (напр. `contact_phone`) должны быть field-encrypted *до* запуска тоже. Отмечено, не предположено.

## Consequences

### Positive
- Необратимый blind-index/шов корректен с первого аккаунта; никакого будущего rewrite пути восстановления или backfill HMAC.
- Защитимая ФЗ-152 at-rest позиция на запуске (storage baseline + защита lookup-колонки).
- Раскатка field-encryption идёт безопасно за стабильным швом.
- Намерение ADR-0012 реализовано, а не молча отброшено.

### Negative
- Ограниченная crypto-шов + blind-index + storage-encryption работа до запуска.
- Storage-baseline-как-launch-floor нуждается в явном sign-off security+legal (остаточное решение, выведено на поверхность).

### Neutral
- Переиспользует паттерн `phone_hash` HMAC; никакого нового crypto-примитива.
- Компонуется с ADR-0017 (резидентность) — оба обязательны, ни один не заменяет.

## Implementation Notes (backend + devops + security/legal)
- **backend**: шов `CryptoService` + env-ключ (KMS swap-point); `email` → ciphertext + HMAC blind-index; перенаправить `/auth/recover/email/*` на индекс. Затем застейджить пер-колоночное field-encryption за швом.
- **devops**: включить encrypted-volume/storage-level шифрование на PII-несущих хранилищах (с РФ-резидентностью ADR-0017).
- **security + legal**: sign off launch at-rest порог (storage baseline + blind-index) vs требование конкретного field-encryption до запуска; **владелец** ратифицирует.
- **doc-keeper**: реконсилировать at-rest утверждения `nfr/security.md` с реальным застейдженным состоянием (аудит отметил устаревшие «published»/Phase-2 утверждения).

## Related Decisions
- **ADR-0012** — ПДн в покое (этот ADR обеспечивает и упорядочивает его форму; без supersession).
- **ADR-0017** — РФ-резидентность данных (где vs как-защищено; оба обязательны).
- **ADR-0011** — прецедент blind-index `phone_hash` HMAC.

## References
- ADR-0012 §сплит форма-vs-раскатка; `data-governance.md §1` инвентарь ПДн.
- `security/security_specification.md` (field-level шифрование для высокочувствительных ПДн).
- `backend/src/modules/auth/*` путь восстановления (сейчас plaintext email lookup).
- `AUDIT_2026-06-30.md` Part A MAJOR (форма ADR-0012 не реализована).
