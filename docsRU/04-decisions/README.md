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

## Шаблон

Используйте [шаблон ADR](template.md) для создания новых архитектурных решений.

## Связанные документы

- [Спецификации доменов](../specs/)
- [Требования](../02-requirements/)
- [Архитектура](../03-architecture/)
