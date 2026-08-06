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
- [ADR-0016: Модель провайдера — организация | физлицо | агент-провайдер](0016-provider-model.md) *(Accepted — sign-off security+legal 2026-07-01: матрица верификации T0–T3 + трёхрежимный иммунитет; остаточные продуктовые OD-3/4/5 открыты)*
- [ADR-0017: Локализация данных в РФ — ПДн граждан РФ остаются в Российской Федерации](0017-rf-data-residency.md) *(Accepted 2026-07-02 — go владельца на РФ-only топологию; P0 блокер резидентности закрыт на уровне решения; devops реализует region-pin + fail-on-non-RF guardrail)*
- [ADR-0018: Правило межагрегатного доступа — чтение животного через AnimalService (подтверждает ADR-0004)](0018-cross-aggregate-access-rule.md) *(Accepted 2026-07-04, подтверждено владельцем 2026-07-05 — split из двух частей (single-row + кэш производного `market`), подтверждает ADR-0004)*
- [ADR-0019: ПДн в покое — реализовать форму ADR-0012 сейчас (blind-index + crypto-шов), раскатку отложить](0019-pii-at-rest-form-enforcement.md) *(Accepted — владелец ратифицировал OD-1/OD-2 2026-07-01; at-rest sign-off security+legal; остаточное расследование сертифицированного СКЗИ)*
- [ADR-0020: Версионируемая модель записи согласий — append-only журнал `consents`; раздача контактов только при согласии](0020-versioned-consent-record-model.md) *(Proposed — готово; ожидает решения владельца по OD-1 seam / OD-2 гранулярность согласия / OD-3 смена дефолта; закрывает юридический блокер выхода A5)*
- [ADR-0021: Первый реальный потребитель outbox — путь in-app-уведомлений (конец «тихого» слоя событий)](0021-first-outbox-consumer-notification-path.md) *(Proposed — закрывает мёртвый слой событий AUDIT3 #2/#3; один потребитель IN_APP-уведомлений, forward-only replay + ограждение no-purge; email/SMS форма-отложено)*
- [ADR-0022: Мультиролевой пользователь — junction `user_roles` + шов JIT self-claim (form-now)](0022-multi-role-user.md) *(Accepted 2026-07-05 — Wave-D D6; junction с primary `users.role`, спит в MVP; регулируемый self-claim гейтится тиром ADR-0016; OD-A/OD-B разрешены)*
- [ADR-0035: Базис ETag / оптимистичной блокировки листинга отвязан от `updated_at` (счётчик просмотров — вне пути конкурентности)](0035-listing-view-count-off-etag-basis.md) *(Accepted 2026-07-08 — Slice H2 / P0-2; ETag выводится из выделенной `listings.content_updated_at`, миграция 0035; записи read-path/системные (view_count/escalated_at/market) больше не ротируют валидатор, закрывая ложный 412 edit-lockout / рычаг гриферства через накрутку просмотров)*
- [ADR-0036: Выдача учётных данных агенту — расстубливание `service_credentials` (credential от человека → короткоживущий JWT AGENT)](0036-agent-credential-issuance.md) *(Accepted 2026-07-09 — AUDIT4 §4a agent-auth bootstrap BLOCKED; секрет, выданный человеком-ADMIN, обменивается на короткоживущий JWT AGENT через существующий верифицированный путь access-token; хеширование/ротация/отзыв на таблице 0017; поведение под гейтом `feature_toggles.agent_service_auth` (off); парный к ADR-0037 — вместе разблокируют Северную звезду)*
- [ADR-0037: Scoped-ability для принципалов AGENT — deny-by-default, без `manage:all`, эффективные = матрица-роли ∩ scope](0037-agent-scoped-ability.md) *(Accepted 2026-07-09 — AUDIT4 P1-6; уточняет ADR-0011 §7 для authz-слоя: матрица role→ability = потолок, эффективные abilities AGENT = потолок ∩ явный least-privilege scope, deny-by-default; dormant-form-first по миграции 0034; moderation-agent — эталонное отображение; scope хранится в именованных `agent_capability_profiles` с самого начала — решение владельца, переопределившее рекомендацию «A-сейчас/B-потом»)*
- [ADR-0038: Запись о подтверждённой сделке как источник истины — самостоятельная append-only сущность (не проекция), полиморфный субъект, эмитент событий](0038-confirmed-sale-record-of-truth.md) *(Accepted 2026-07-09 — спека 18-reputation §12 пункты 1/7/9 (ConfirmedSale.*); AUDIT4 P3-1. `confirmed_sales` — своя append-only сущность, заякоренная на COMPLETED-передачу или listing markSold (не view); полиморфный `offering_type` (шов mig-0032) + производный `market`; outbox-события `ConfirmedSale.*`; form-now dormant захват-с-якорем-передачи под `sale_buyer_confirmation`/`reputation_reviews`. Откр-Q владельцу: захватывать `amount_minor`?)*
- [ADR-0039: Модель хранения репутации — материализованный per-(subject, market) агрегат поверх append-only отзывов; удаление сохраняет рейтинг](0039-reputation-storage-model.md) *(Accepted 2026-07-09 — спека 18-reputation §12 пункты 2/3/8/9 (Review.*). Материализованный `reputation_aggregates` (инкрементально O(Δ), никогда on-read/вручную); per-market PK поверх одной личности (развилка 6, ADR-0002 структурно); отзывы append-only, разрешаются на монотонном `seq` (урок mig-0036); удаление = псевдонимизировать-автора-сохранить-рейтинг (развилка 8, legal-гейт). Откр-Q владельцу: основание ФЗ-152 для удержания рейтинга удалённого пользователя + политика свободного текста)*
- [ADR-0040: Целостность доверия и управление репутацией — тир верификации ортогонален (взвешивание зарезервировано), споры как подтип `content_report`, агент-как-модератор-отзывов (не рецензент)](0040-reputation-trust-integrity-governance.md) *(Accepted 2026-07-09 — спека 18-reputation §12 пункты 4/5/6; AUDIT4 P3-1/§8. Тир верификации ортогонален в MVP (dormant-хук взвешивания), анти-Sybil = proof-of-transaction + квота + anomaly→модерация; споры/абьюз отзывов переиспользуют модерацию как подтип `content_report` (без параллельного суда); агент-как-модератор-отзывов через scope ADR-0037, агент-как-рецензент отложено/НЕТ; репутация никогда не монетизируется (развилка 7). Откр-Q владельцу: разрешать ли когда-либо агент-написанные отзывы? активировать тир-взвешивание по данным о мошенничестве?)*
- [ADR-0041: `SameSite=Strict` у refresh-куки привязывает ZooLink к одно-сайтовой краевой топологии (кросс-сайтовый SPA потребует пересмотра)](0041-refresh-cookie-samesite-single-site-topology.md) *(Accepted 2026-08-06 — AUDIT5 frontend-engineer Б-2/Б-3/§7.2, вскрыто паком базового пути F1a. `Strict` = сильнейшая CSRF-позиция и бесплатна при same-origin крае ADR-0009; молча закрепляет одно-сайтовый (тот же регистрируемый домен) фронт. Сейчас держим Strict — НЕ ослаблять преждевременно. Разбиение по same-site поддоменам нужен лишь засеянный `CORS_ORIGINS`; **кросс-сайтовый** SPA (другой регистрируемый домен / кросс-сайт CDN) ОБЯЗАН переоткрыть этот ADR — ослабить SameSite→Lax/None;Secure И добавить компенсирующий CSRF-токен. Без изменений кода/схемы.)*

> **Памятка по решениям:** [Ecosystem ADR Plan & Open-Decision Memo (Q1–Q6)](ECOSYSTEM_ADR_PLAN.md) — бриф архитектора; **Q1–Q6 ратифицированы владельцем 2026-07-01** (0014+0015 Accepted совместно; **0016 и 0019 Accepted 2026-07-01** по sign-off security+legal — у 0016 остаточные продуктовые OD-3/4/5, у 0019 остаточное расследование сертифицированного СКЗИ; **0017 Accepted 2026-07-02** по go владельца на РФ-топологию; 0018 остаётся Proposed с явным условием-ожидания).

## Шаблон

Используйте [шаблон ADR](template.md) для создания новых архитектурных решений.

## Связанные документы

- [Спецификации доменов](../specs/)
- [Требования](../02-requirements/)
- [Архитектура](../03-architecture/)
