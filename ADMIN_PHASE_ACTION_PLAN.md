---
version: "1.1"
lastUpdated: "2026-06-22"
author: "Orchestrator (+ 8-agent cross-check)"
status: "Active — pre-Admin-Slice-2-4"
governing-rule: "IMPLEMENTATION_PLAYBOOK.md §5 (границы фаз по cost-of-change) + [[phasing-decision-rule]]"
sources: "REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md (GAP-TRACE-001..014) + CAPABILITY_DIGEST.md (DIV-1..9) + cross-check (architect/backend/ux/ui/frontend/qa/devops/doc-keeper)"
---

# ZooLink — Action Plan v1.1 (разблокировка и переход к Admin Slice 2-4)

Единый порядок действий под **новым принципом фазирования** (cost-of-change, agent-first, тест на переписывание —
`IMPLEMENTATION_PLAYBOOK.md §5`). v1.1 учитывает кросс-проверку 8 агентов-экспертов (см. «Конвергентные находки»).

## Принцип (выжимка G1)
Тащим в реализацию сейчас, если: (1) бизнес-требование (ИИ-агентная модерация/админ — ADR-0006), (2) отсрочка =
переписывание схемы/контракта/actor/authz на ЛЮБОЙ будущей фазе, (3) дёшево. Откладываем только если дешевле потом
**И** нет риска переписывания **И** не бизнес-требование. Необратимое — сейчас; поведение — за forward-compatible гейтами.

## Легенда: ✅ done · 🔄 in-progress · ⏳ todo · 🔗 blocked-by · 👤 owner-agent · severity 🔴/🟠/🟡

---

## 🎯 Цель-стопор
**Запланировать и начать Admin Slice 2-4.** Блокеры — фазы A + B0. B/C/D/E — параллельны/для честности.

## Конвергентные находки кросс-проверки (ранг = число независимых агентов)
- **C1 🔴 (6 агентов):** `actor_principal_type` не пишется на действии (`audit_log`, `moderation_decisions` — append-only, необратимо) + нет формы human-override → **A0a**.
- **C2 🔴 (2):** `rbac-matrix.md:18-21` («agent-service-auth deferred to Фаза 2») противоречит новому правилу → переписать «форма сейчас / поведение gated» → **A0a/ADR-0011**.
- **C3 🔴 (4):** контрактный conformance-гейт до codegen (casing/PageMeta/Problem/LocalizedString/ETag/роли) → новая **B0**.
- **C4 🟠 (2):** authz-субъект уже агент-агностичен; A0-backend ≈ один authenticator-chain (S). Реальный пропуск — schema-форма (C1).
- **C5 🔴 (3):** `principal_type`+override в форме ОТВЕТА контрактов + правило API_CONVENTIONS «actor={id,principal_type}» → **A0a + B0**.
- **C6 🟠 (4):** reference-data форма (`sort_order`, `created_by/updated_by`, локализация flat→JSONB, audit entity_id для INT) → **A2**. (`is_active` уже есть.)
- **C7 🟠 (2):** A2 extensibility-first; `animal-statuses`=не датасет; breeding-словари=таблица, soft-tags=текст → **A2/A3**.
- **C8 🟠 (2):** scheduler-формы нет (`@nestjs/schedule` отсутствует) → **B (scheduler-форма)**.
- **C9 🟠 (1):** observability агент-действий (log/metric/correlation) → **B**.
- **C10 🟠 (2):** D1 analytics = форма контракта → **B**.
- **C11 🟠 (1):** DIV-6 → A + негативные authz-тесты; слой негативных тестов/DoD добавить во все фазы.
- **C12 🟠 (2):** moderation claim/lock/SLA/decision-templates (spec 12 round-5) → форма контракта в **B** (до Moderation-домена).
- **C13 🟡 (2):** env/секрет-формы (agent-signing, PII-key/KMS, Apple .p8); `favorites-api.yaml` без RU; glossary-термины; doc-keeper батчит **по файлу**.

---

## Карта зависимостей (v1.1)
```
G1 ✅  F ✅
                          ┌─────────────────────────────────────────────┐
ПЛАНИРОВАНИЕ Admin 2-4 ◄──┤ ФАЗА A: (A0a ∥ A0b ∥ A1) ─► A2 ─► A3   🔴   │
                     ◄────┤ B0 (contract conformance gate)         🔴   │
                          └─────────────────────────────────────────────┘
B (anti-rewrite формы: analytics/scheduler/observability/PII-env/moderation-shape) ─┐
C (batch BR doc-sync, по файлу)                                                      ┼ параллельны
D (stage: worker-impl, OAuth-адаптеры)                                               │
E (реальный defer: accessibility; DIV-8)                                            ─┘
ADR-0011 (agent-principal) — выход A0a, ссылается из A1/B0
```

---

## ФАЗА A — 🔴 Разблокировать Admin Slice 2-4

### A0 — разбит на A0a + A0b (C1/C2/C4/C5)
| ID | Действие | 👤 | 🔗 | Статус |
|----|----------|----|----|--------|
| **A0a** 🔴 | **Schema-форма актёра (необратимо):** `actor_principal_type` на `audit_log` + `moderation_decisions`; форма human-override (рекоменд. — новая append-only строка со ссылкой `supersedes_decision_id`, не мутация); снапшот `actor_role`; agent lifecycle (деактивация, не удаление). Переписать `rbac-matrix.md:18-21` (форма сейчас/поведение gated). Выход — **ADR-0011** (Amends ADR-0006, не переписывать 0006). DoD: негативные тесты (AGENT проходит гвард; override пишется с актёром-человеком; append-only отвергает UPDATE/DELETE). | architect→backend→doc-keeper | — | ✅ (2026-06-23: ADR-0011 + миграция 0016 + RU-зеркало; §E negative tests green) |
| **A0b** 🟠 | **Agent-service-auth ФОРМА (без переписывания гвардов):** вынести аутентификацию из `JwtAuthGuard` в цепочку `RequestAuthenticator` (`BearerJwt` сейчас; `AgentServiceToken` аддитивно потом); env-форма signing-секрета (≥32); схемная форма хранения/ротации/revoke service-credential; **внутри монолита** (ADR-0009, не отдельный сервис). Поведение агента — за гейтом. | architect(ADR-0011)→backend→devops | — (∥ A0a) | ✅ (2026-06-23: authenticator-chain + service_credentials миграция 0017; 174 unit + 41 e2e green; gated) |

### A1 — Канон ролей (GAP-004/008 + schema-гигиена)
| ID | Действие | 👤 | 🔗 | Статус |
|----|----------|----|----|--------|
| **A1** 🔴 | 7 ролей канон; синхрон identity-BR (+BREEDER/FARMER), admin-BR (−SUPER_ADMIN из `users.role`, additive-модель), org-BR (−MODERATOR). **Протянуть 7-ролевой enum в `admin-api.yaml`** (не только auth-api/schema — C3/frontend). **Устранить дубль `role_in_org`** (schema:79 inline с MODERATOR vs :986 named без + comment :722). `principal_type` ⟂ роли — закрепить в ADR-0011, не дублировать. DoD: негативные тесты CHECK (SUPER_ADMIN reject, org-MODERATOR reject) + двойной прогон миграции. | architect→doc-keeper→backend | A0a(инвариант ⟂) | ✅ (schema role_in_org + 7-ролей в admin-api + rbac-matrix ✅; BR-doc sync identity/admin/org +RU выполнен в A1-BR-волне 2026-06-24) |

### A2 — Модель reference-data (GAP-001 + DIV-9 + C6/C7)
| ID | Действие | 👤 | 🔗 | Статус |
|----|----------|----|----|--------|
| **A2** 🟠 | INT-таблицы канон; **registry extensibility-first** (добавление датасета без смены формы); добавить **`sort_order`** + **`created_by/updated_by`** на species/breeds/cities; **решение по локализации** (мигрировать flat `name_ru/name_en`→`name_localized` JSONB по канону `localization_specification.md` — рекоменд. — ИЛИ ADR на «плоские = lookup» + правка спеки); **форма аудита reference-CRUD для INT** (`audit_log.entity_id` UUID ≠ INT → доп. колонка/ключ); spec 06 `5→3` датасета (:17/:69). Admin отдаёт **обе локали** (редактор), публичные — резолвленную строку. DoD: seed×2 идемпотентно, drift-check, негативный append-only-тест аудита. | architect→backend→doc-keeper | — | ✅ (2026-06-23: миграция 0018 flat→JSONB+sort_order/provenance+entity_id_int; код→nameLocalized; seed×2; spec06 EN 5→3; RU pending) |

### A3 — Словари (GAP-002 + C7)
| ID | Действие | 👤 | 🔗 | Статус |
|----|----------|----|----|--------|
| **A3** 🟠 | `animal-statuses` — **убрать** (это state-enum, не датасет). breeding-словари (`health_certifications`, `genetic_markers`) — **таблица сейчас** (форма, фильтры потом). soft-tags (`temperament_tags`, `health_flags`) — **свободный текст/JSONB**, lookup аддитивно в Фазе 2. `decision-templates` (модерация) — решить таблица/текст вместе с A2/A3. Каждый новый словарь = миграция + idempotent seed. | architect→backend | A2 | ✅ (2026-06-23: health_certifications+genetic_markers таблицы миграция 0019, datasets 3→5 enum+code+spec06 EN сверены; soft-tags=текст; animal-statuses убран; decision-templates→B10; 34 табл; миграция×2+seed×2; **A3-агент упал на API overload — реконсиляцию+верификацию доделал оркестратор**; RU pending) |

---

## ФАЗА B0 — 🔴 Contract conformance gate (до любого codegen; ∥ A) — НОВОЕ (C3/C5)
| ID | Действие | 👤 | Статус |
|----|----------|----|--------|
| **B0.1** 🔴 | **JSON casing canon** (camelCase vs snake_case) — нормативно в `API_CONVENTIONS.md` §0; все 12 контрактов приведены к camelCase (тела). ⟵ **owner-decision** | architect→doc-keeper | ✅ (2026-06-23) |
| **B0.2** 🔴 | **`{items, meta: PageMeta}`** во всех списках; offset/hasMore убраны из matching; PageMeta cursor-ready (`nextCursor` аддитивно). ⟵ **owner-decision** | architect→doc-keeper | ✅ (2026-06-23) |
| **B0.3** 🔴 | **RFC7807 `Problem`** во все non-2xx всех 12 контрактов (custom `Error`-схемы убраны); enum `code` в API_CONVENTIONS §4 | doc-keeper | ✅ (2026-06-23) |
| **B0.4** 🔴 | **`LocalizedString {en,ru}`** унификация — убраны flat `name_ru/name_en` (org/admin) и freeform-JSONB localized-карты (listings/animals/org/moderation); admin отдаёт обе локали | doc-keeper | ✅ (2026-06-23) |
| **B0.5** 🔴 | **`If-Match`/`ETag` (412/428)** на мутирующих admin/moderation PATCH (+ listings/animals/org/branch entity-PATCH); state-transition-эндпоинты сохраняют guard-based 409 | doc-keeper | ✅ (2026-06-23) |
| **B0.6** 🟠 | **actor в ответах = `{actorId, principalType}`** (agent-badge) — правило API_CONVENTIONS + применить к moderation/audit-формам (C5). **НЕ сделано — блок ADR-0011**; TODO-пометки оставлены в admin-api/moderation-api (moderatorId/performedBy/resolvedBy/updatedBy остаются плоскими) + в API_CONVENTIONS §«Conformance status» | architect→doc-keeper | ⏳ (blocked ADR-0011) |
| **B0.7** 🟡 | `favorites-api.yaml` → RU-зеркало создано | doc-keeper | ✅ (2026-06-23) |
| **B0 (роль-enum, A1)** 🔴 | 7-ролевой enum (USER,MODERATOR,ADMIN,BREEDER,FARMER,VETERINARIAN,GROOMER) протянут в `admin-api.yaml` (UserRoleInfo/UserSummary/фильтр /users/roles/ChangeUserRoleRequest) — было 3 | doc-keeper | ✅ (2026-06-23) |

---

## ФАЗА B — 🟠 Anti-rewrite формы (∥ A; до кодинга соответствующих доменов)
| ID | Действие | Источник | 👤 | Статус |
|----|----------|----------|----|--------|
| **B1** | PII-at-rest — ADR + **env/KMS-форма ключа** (`PII_ENCRYPTION_KEY≥32` или `KMS_*`, +`.env.example`); согласовать с `erase_user`/HMAC | GAP-013, OPS-02/12 | architect→devops | ⏳ |
| **B2** | Auth/session-форма — **сверить факт** `refresh_tokens` (есть `device_label`/`family_id`; нет `ip_address`/`user_agent`/`last_used_at`/`revoked_reason`); добавить названные колонки; **MFA — без плейсхолдер-колонки** (убрать ложное «infrastructure prepared») | GAP-013, F2/F11 | architect→backend | ✅ (2026-06-24: миграция 0020 ip_address/user_agent/last_used_at/revoked_reason; PG×2; nfr MFA-claim → doc-keeper) |
| **B3** | LEASING — `leasing` в `listing_type` enum (DB-workflow) + гейт; проверить триггеры listings | GAP-005 | backend→doc-keeper | ✅ (2026-06-24: миграция 0021; listings_listing_type_check 6 значений; триггеры не хардкодят set; spec/BR-пометка → doc-keeper) |
| **B4** | matching — НЕ резать scoring; `x-phase:2`+nullable; MVP=hard-predicate eligible-set; `ineligibilityReason`=код; синхрон BR↔spec 05 | GAP-003 | architect→doc-keeper | ✅ (2026-06-24) |
| **B5** | Дубль role-change — `admin-api.yaml /users/{id}/role` + `/users/roles` → superseded; владелец admin-identity-контракта; **расширить на дубль moderation-блока** admin-api vs moderation-api (словарь решений/статусов) | DIV-2/3, ux-1 | architect→doc-keeper | ✅ (2026-06-24: admin-api /users/{id}/role + /moderation/* deprecated; кода нет — DIV-4) |
| **B6** | Гигиена auth-api — `dev-token`→dev-only; `whoami`/`operator-check`→`x-internal` | DIV-1/5 | doc-keeper | ✅ (2026-06-24: dev-token x-internal; DIV-1 закрыт) |
| **B7** | **Scheduler-форма** — `@nestjs/schedule` в worker + паттерн advisory-lock (multi-instance); основа для auto-expire/retention | GAP-012, OPS-04 | devops→backend | ✅ (2026-06-24: `@nestjs/schedule@^6.1.3` (v4/5=Nest≤10!) + `lib/scheduler` AdvisoryLockService `pg_try_advisory_lock` + `RetentionExpireJob` @Cron-скелет (no-op, isTest-guard); `SchedulerModule` только в WorkerModule; D2 — поведение потом) |
| **B8** | **Observability агент-действий** — log-field `principal_type` (+PII-редакция), metric-label `principal_type`, correlation-id цепочки агент→override | ADR-0006, OPS-06 | devops | ✅ (2026-06-24: `AuditEntry.actorPrincipalType` → пишется в `audit_log.actor_principal_type` (default HUMAN); prom-counter `zoolink_audit_actions_total{principal_type,action}` (MetricsService @Optional → no-op в worker); Pino `customProps` стампит principalType/actorId/actorRole из req.user, x-request-id=correlation, PII-redact сохранён — проверено в e2e-логах) |
| **B9** | **D1→B: analytics-форма контракта** — `GET /listings/{id}/analytics` + org/branch-агрегат; решить счётчики vs series; counts_by_status/market для skeleton | GAP-011, C10 | architect→doc-keeper | ✅ (2026-06-24: counters + series x-phase:2; API_CONVENTIONS §16; EN+RU. Флаг: listings нет view_count/contact_shown_count — схема при impl) |
| **B10** | **Moderation contract-shape** (до Moderation-домена) — claim/lock (`assigned_to`/`locked_at`/`lock_expires_at` + `409`), SLA (`waiting_seconds`/`sla_state`/`escalated`), market-фильтр очереди, decision-templates | spec 12 round-5, C12 | alpha-analyst→doc-keeper | 🔄 (contract-shape done; **decision_templates TABLE ✅ 2026-06-24** backend: миграция 0022 — INT lookup в форме A2/A3 (`body_localized` JSONB + `applies_to_decision` + `market` + опц. `related_reason_code` FK→moderation_reasons + provenance, UNIQUE (market,code), GIN, trigger, seed×3); таблиц +1 → 35; форма сейчас, выбор шаблона при decision — Moderation-домен; RU data-model/spec/moderation-api ✅ синхронизированы 2026-06-24) |

---

## ФАЗА C — 🟡 Batch BR doc-sync (EN↔RU; редактировать ПО ФАЙЛУ, не по фазе — C13)
| ID | Действие | Источник | Статус |
|----|----------|----------|--------|
| **C1** | FLAG → CHANGES_REQUESTED (admin-BR) + glossary-запись | GAP-006 | ✅ (A1-волна) |
| **C2** | ownership transfer в scope | GAP-007 | ✅ (2026-06-24) |
| **C3** | passwordless (пароль=operator-only) | GAP-009 | ✅ (2026-06-24) |
| **C4** | JWT 15m/7d + phone HMAC | GAP-010 | ✅ (2026-06-24) |
| **C5** | убрать «auto-purge 30 дней» (или ADR retention-job → B7) | GAP-013-sub | ✅ (2026-06-24) |
| **C6** | glossary EN+RU: `agent-service-auth`, `principal-source-agnostic`, `CHANGES_REQUESTED`, `dataset` (agent-* определения — architect) | C13 | ✅ (B0-волна) |
> 👤 doc-keeper. Все правки — синхронно EN+RU, батч по файлу (`admin-domain.md` правят A1/A2/C1/D4 — один проход).

---

## ФАЗА D — 🟢 Stage (после форм из A/B)
| ID | Действие | Источник | Статус |
|----|----------|----------|--------|
| **D2** | Авто-экспирация — **реализация** поверх B7-scheduler-формы | GAP-012 | ✅ (2026-06-24: `RetentionService` (lib/scheduler) под B7 advisory-lock — (а) ACTIVE-листинги `expires_at<now()`→EXPIRED (set-based parametrized SQL; approval-gate триггер пропускает →EXPIRED; дормант пока Listings не ставит expires_at), (б) DEACTIVATED `deactivated_at<now()-grace` & `erased_at IS NULL`→`erase_user` (актёр=system, principal HUMAN-default; mirror AdminUserService field-actions + inline session-revoke, без auth-module в worker); `RETENTION_GRACE_DAYS`/`RETENTION_TICK_CRON` env, isTest-guard, идемпотентно; интеграционные на live PG 4✅ — verify within-grace/within-expiry НЕ трогаются; spec01 «MVP has no scheduler» закрыт; миграций НЕ нужно; **RU-зеркало spec01 + data-governance §2 ✅ 2026-06-24 doc-keeper**) |
| **D3** | OAuth google/apple/vk — адаптеры; **расширить env под Apple** (`TEAM_ID`/`KEY_ID`/`.p8`-mount) | DIV-7, OPS-11 | ✅ (env-форма done; реальные адаптеры defer-by-design — аддитивны, нужны живые секреты, без переписывания. 2026-06-24: **env-форма Apple ✅** — `OAUTH_APPLE_TEAM_ID`/`OAUTH_APPLE_KEY_ID`/`OAUTH_APPLE_PRIVATE_KEY` (.p8-контент в env-var, mount-как-секрет-файл паттерн как у прочих секретов — без путей/ключей в репо); optional dev/test, prod required-вместе если задан хоть один (superRefine); `.env.example` синхрон. **Реальные адаптеры google/apple/vk остаются defer** (stub-on-empty/prod-503; нужны живые секреты, аддитивны) — трек-пометка) |
| **D4** | reference-CRUD-аудит (read-видимость → поднять в B0.6/B8) + operator-password-policy spec | GAP-006-sub | ✅ (2026-06-24, doc-keeper: spec06 EN+RU «Reference-data audit & operator security (D4)» — мутации reference пишутся в `audit_log` через `entity_id_int` (A2) и читаемы через `GET /audit/log` фильтр actor/entityType=reference-data → закрывает GAP-006-sub versioning; operator-password-policy слинкован на `security_specification.md` (12+complexity/bcrypt≥12/lockout 5×15м/TTL 15м-7д), без новой инфры. Флаг: `getAuditLog.entityId`/`AuditLogEntry.entityId` = format:uuid → INT reference-id не фильтруется → contract-owner) |

## ФАЗА E — ⚪ Реальный defer (tracked)
| ID | Действие | Статус |
|----|----------|--------|
| **E1** | accessibility/WCAG → frontend-DoD (маппинг, не растворить) | ✅ (2026-06-24, doc-keeper: `nfr/accessibility.md` EN+RU «Phase & tracking status (E1) — GAP-014» — WCAG 2.1 AA/ФЗ-381 = frontend-phase requirement, замаплено на frontend-DoD (этот файл = входной чеклист при старте фронт-фазы); выделенного frontend-DoD файла нет → заметка = авторитетный маркер) |
| **E2** | chat (ADR-0005) / NFT-хуки / payments-гейт — корректные гейты, оставить | ✅ |
| **E3** | DIV-4 (admin-api опережает) — в реестр «верифицировать форму при Slice 2-4»; **DIV-6 → перенесён в A** (authz-тесты) | ✅ (2026-06-24: DIV-4 зарегистрирован — дубли deprecated в B5, остальное admin-api = осознанный contract-ahead, верифицировать форму при Slice 2-4; DIV-6 ability-map forward-declared, негативные authz-тесты добавляются по мере выкатки доменов — зафиксировано в DoD §6) |

---

## DoD-addendum (ко всем фазам A/B — C11)
Каждая фаза на выходе проходит `IMPLEMENTATION_PLAYBOOK §6`, включая: **тест на переписывание** (письменно: отсрочка → переписывание схемы/контракта/actor/authz? да/неясно → форму сейчас); **негативные тесты инвариантов**; **EN↔RU синхрон**; **seed×2 + drift-check** для schema-изменений.

## Owner-decisions
**✅ Решено (2026-06-23) — канон, обязателен для всех фаз/агентов:**
1. **JSON casing = camelCase** (тела API; БД остаётся snake_case). Привести listings/org-контракты под camelCase. → закрепить в `API_CONVENTIONS.md` (B0.1).
2. **Pagination = page/limit + cursor-ready** конверт `{items, meta}`; `meta.next_cursor` добавляется аддитивно для высокочастотных операторских очередей без смены формы; offset убрать (B0.2/B10).
3. **Локализация lookup = мигрировать flat→JSONB** (`name_localized {ru,en}`, канон `localization_specification.md`); единый UI-редактор + расширяемость языков (A2/B0.4).
4. **Human-override = новая append-only строка + `supersedes_decision_id`** (без мутации; полная цепочка агент→человек) (A0a).

**✅ Решено (2026-06-24):**
5. **«Решено ИИ» — показывать ВСЕМ** (operators/audit + конечный пользователь/продавец): owner-facing moderation-результат несёт principal_type/agent-атрибуцию (B10/B0.6). Прозрачность, согласуется с AI-run-видением.
6. **Analytics = счётчики + series-ready** форма: сейчас counts-снимки (views/contacts/last_activity), `meta`/форма допускает аддитивное добавление временных рядов без смены (B9).

## Рекомендуемый порядок (v1.1)
1. **Owner-decisions 1–4** (foundational, гейтят A0a/A2/B0).
2. **A0a + A0b + A1** (∥, связка через architect → ADR-0011) + **B0** (contract gate, ∥).
3. **A2 → A3**.
4. **B** (формы) + **C** (doc-sync по файлу) — параллельно.
5. Планирование **Admin Slice 2-4**.
6. **D / E** — stage/tracked.

## ✅ Выполнено
- **G1** (правило фаз: playbook §5+DoD, оба CLAUDE.md). Память [[phasing-decision-rule]].
- **F** (оба аудита в «Аудиты» CLAUDE.md).
- **Шаг 2** (этот план) + **Шаг 3** (кросс-проверка 8 агентов, сведена в v1.1).
