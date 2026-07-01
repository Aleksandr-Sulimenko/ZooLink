# Архитектурные решения (Architecture Decision Records)

Этот каталог содержит все архитектурные решения (ADR) для проекта ZooLink.

## Список ADR

- [ADR-0001: Выбор технологического стека](0001-tech-stack.md)
- [ADR-0002: Жёсткое разделение рынков домашних животных и скота](0002-hard-split-markets.md)
- [ADR-0003: Премодерация рабочего процесса для объявлений](0003-pre-moderation-workflow.md)
- [ADR-0004: Животное как агрегатный корень](0004-animal-as-aggregate.md)
- [ADR-0005: Нет встроенного чата в MVP](0005-no-chat-mvp.md)
- [ADR-0006: ИИ-агенты как операторы площадки (модерация, админ и далее)](0006-ai-agents-operate-platform.md)
- [ADR-0007: Стратегия ORM — Prisma как основной + типизированный raw-SQL escape hatch](0007-orm-strategy.md)
- [ADR-0008: Матрица сторонних провайдеров под РФ](0008-rf-provider-matrix.md)
- [ADR-0009: Архитектура MVP — модульный монолит; микросервисы/K8s — Фаза 2+](0009-mvp-vs-target-architecture.md)
- [ADR-0010: Готовность к цифровым активам (NFT) — хуки в схеме сейчас, on-chain в Фазе 2+](0010-nft-digital-assets-hooks.md)
- [ADR-0011: Модель актёра-агента — снапшот актёра, human-override, forward-совместимый service-auth](0011-agent-principal-actor-model.md)
- [ADR-0012: Шифрование ПДн в покое (ФЗ-152)](0012-pii-at-rest-encryption.md)
- [ADR-0013: Передача владения в MVP — упрощённая прямая передача, контролируемый owner-lock, отложенные верификационные гейты](0013-mvp-ownership-transfer.md)
- [ADR-0014: Супертип Offering — полиморфный шов discovery + moderation (анти-god-table)](0014-offering-supertype-polymorphic-seam.md) *(Accepted — ратифицировано 2026-07-01, совместно с 0015)*
- [ADR-0015: `market_scope` — уточнение жёсткого сплита ADR-0002 для предложений без вида животного](0015-market-scope-refines-0002.md) *(Accepted — ратифицировано 2026-07-01, совместно с 0014)*
- [ADR-0016: Модель провайдера — организация | физлицо | агент-провайдер](0016-provider-model.md) *(Proposed — ожидает матрицу верификации от security+legal)*
- [ADR-0017: Локализация данных в РФ — ПДн граждан РФ остаются в Российской Федерации](0017-rf-data-residency.md) *(Proposed — P0 go-live; ожидает go владельца по топологии/стоимости РФ)*
- [ADR-0018: Правило межагрегатного доступа — чтение животного через AnimalService (подтверждает ADR-0004)](0018-cross-aggregate-access-rule.md) *(Proposed — готов; ожидает кивок владельца)*
- [ADR-0019: ПДн в покое — реализовать форму ADR-0012 сейчас (blind-index + crypto-шов), раскатку отложить](0019-pii-at-rest-form-enforcement.md) *(Proposed — ожидает at-rest sign-off от security+legal)*

> **Памятка по решениям:** [Ecosystem ADR Plan & Open-Decision Memo (Q1–Q6)](ECOSYSTEM_ADR_PLAN.md) — бриф архитектора; **Q1–Q6 ратифицированы владельцем 2026-07-01** (0014+0015 Accepted совместно; 0016–0019 остаются Proposed с явными условиями-ожидания).

## Шаблон

Используйте [шаблон ADR](template.md) для создания новых архитектурных решений.

## Связанные документы

- [Спецификации доменов](../specs/)
- [Требования](../02-requirements/)
- [Архитектура](../03-architecture/)
