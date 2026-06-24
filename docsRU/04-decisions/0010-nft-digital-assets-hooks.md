# ADR-0010: Готовность к цифровым активам (NFT) — хуки в схеме сейчас, on-chain в Фазе 2+

**Status**: Accepted
**Date**: 2026-06-17

## Контекст и постановка проблемы

Токенизация (NFT) — правдоподобное будущее для ZooLink: верифицируемая **родословная**, **сертификаты
породы/выставок** и **владение** животными. В текущем стеке **нет Web3-элемента**. Аудит
(`BACKEND_TECH_AUDIT.md`, Суб-агент 4) заключил, что NFT **корректно вне объёма MVP**, но рекомендовал заложить
**дешёвые хуки в схеме/архитектуре сейчас**, чтобы реализация Фазы 2+ не требовала ломающих изменений.

Схема уже даёт субстрат: родословная (`animals.mother_id/father_id`, `pedigree_id`, `show_titles`,
`health_test_results`), процесс владения (`ownership_transfers`, `animal_ownership_history`) и надёжная исходящая
интеграция (`outbox_events`). Telegram OAuth уже интегрирован — что делает **TON** естественным, дружественным РФ
выбором сети.

## Факторы решения

- **Без затрат/расширения объёма MVP**: хуки должны быть почти бесплатными; никакого on-chain-кода в Фазе 1.
- **Без будущих переделок**: mint/transfer Фазы 2 должны лечь на существующие агрегаты и паттерн outbox.
- **Соответствие РФ**: сеть и UX кошелька должны подходить массовому рынку РФ.
- **Защита ПДн (ФЗ-152)**: никаких персональных данных в публичных on-chain метаданных.

## Рассмотренные варианты

### Сеть
- **TON** — Telegram-нативно (Telegram OAuth уже есть), популярна в РФ, низкие комиссии. **Выбран дефолт.**
- **Polygon (PoS)** — EVM, огромный тулинг/кадры, низкие комиссии. **Принятая альтернатива.**
- Ethereum L1 — отклонён (стоимость газа, оверкилл для сертификатов).

### Хранение метаданных
- **IPFS (с пиннингом) / Arweave** для метаданных+медиа, при этом **PostgreSQL остаётся источником истины**. Выбрано.
- Полностью on-chain медиа — отклонено (стоимость; риск ПДн on-chain).

### Indexer (синхронизация chain → app)
- **The Graph (subgraph)** для EVM, или **собственный listener-воркер** (TON: toncenter SSE; EVM: viem/ethers),
  пишущий обратно через inbox/outbox-таблицу. Решается на этапе реализации.

## Решение

Заложить **только хуки** сейчас; реализовать on-chain в Фазе 2+:

1. Добавить таблицу **`digital_assets`** (см. «Замечания по реализации»), связывающую on-chain токен с
   животным/сертификатом.
2. **Переиспользовать `outbox_events`** для намерений mint/transfer app→chain; добавить indexer-воркер для синхронизации
   chain→app в Фазе 2.
3. Дефолтная сеть **TON** (альт.: Polygon); метаданные на **IPFS/Arweave**; **PostgreSQL — источник истины**.
4. **Кастодиальные / account-abstraction кошельки** для UX массового рынка (пользователи не управляют seed-фразами);
   платформа может спонсировать газ (gasless meta-transactions / кастодиальный режим TON Connect).
5. On-chain метаданные содержат **только публичные верифицируемые факты** (происхождение, титулы) — **никогда** ПДн владельца.

В MVP не строится mint, контракты, кошельки и indexer. Таблица поставляется пустой/nullable и гейтится флагом
`feature_toggles`.

## Последствия

### Положительные
- Токенизация Фазы 2 ложится на существующие агрегаты и паттерн outbox без ломки схемы.
- Выбор сети (TON) опирается на уже интегрированную идентичность Telegram.

### Отрицательные
- Одна неиспользуемая таблица + флаг фичи, проносимые через MVP (пренебрежимая цена).

### Нейтральные
- Выпускать ли вообще NFT — остаётся бизнес-решением; хуки не накладывают обязательств.

## Замечания по реализации

Предлагаемая таблица (DDL попадает в `database_schema.sql`; ERD обновлён):

```sql
CREATE TABLE digital_assets (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id        UUID REFERENCES animals(id) ON DELETE RESTRICT,
    asset_type       VARCHAR(30) NOT NULL CHECK (asset_type IN ('PEDIGREE','CERTIFICATE','OWNERSHIP')),
    chain            VARCHAR(20) NOT NULL DEFAULT 'TON' CHECK (chain IN ('TON','POLYGON')),
    contract_address VARCHAR(120),
    token_id         VARCHAR(120),
    ipfs_cid         VARCHAR(120),
    metadata_uri     TEXT,
    tx_hash          VARCHAR(120),
    mint_status      VARCHAR(20) NOT NULL DEFAULT 'NONE'
                     CHECK (mint_status IN ('NONE','PENDING','MINTED','TRANSFERRED','FAILED')),
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
-- не более одного живого токена на (animal, asset_type)
CREATE UNIQUE INDEX uq_digital_asset_per_type
    ON digital_assets(animal_id, asset_type)
    WHERE mint_status IN ('PENDING','MINTED','TRANSFERRED');
```

- Гейтить всё поведение за `feature_toggles` (ключ, например, `digital_assets`).
- Синхронизация chain→app пишет через outbox/inbox; никогда не доверять состоянию сети без глубины подтверждения.

## Связанные решения

- [ADR-0004](0004-animal-as-aggregate.md): животное — агрегатный корень, к которому привязывается токен.
- [ADR-0008](0008-rf-provider-matrix.md): РФ-позиция по провайдерам (TON через Telegram).
- [ADR-0009](0009-mvp-vs-target-architecture.md): mint/indexer живут в Фазе 2+.

## Ссылки

- `BACKEND_TECH_AUDIT.md` — Суб-агент 4 (Web3 & NFT Expert).
- `ZooLink_ERD.mmd`, `database_schema.sql`, `specs/statemachines/ownership_transfer_state_machine.md`.
