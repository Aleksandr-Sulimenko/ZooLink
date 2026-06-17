---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Спецификация: RBAC-матрица прав (роли × ресурсы)

## Результат
Сделать авторизацию реализуемой без догадок. Определяет конкретную матрицу роль→ресурс→действие и правила
объектного уровня (владение), которые бэкенд обязан применять через CASL + NestJS Guards
([ADR-0001](../../04-decisions/0001-tech-stack.md), `security/security_specification.md`). Это нормативный источник
для деклараций `x-required-roles` в OpenAPI-контрактах (`docs/03-architecture/api-contracts/`).

## Роли
`USER` (по умолчанию), `BREEDER`, `FARMER`, `MODERATOR`, `ADMIN`, `VETERINARIAN`, `GROOMER` (CHECK `users.role`).
`principal_type` может быть `HUMAN` или `AGENT` ([ADR-0006](../../04-decisions/0006-ai-agents-operate-platform.md)) —
AGENT держит операторскую роль (напр. MODERATOR) и подчиняется той же матрице.

BREEDER/FARMER/VETERINARIAN/GROOMER = USER + доп. возможности (видимость для разведения, livestock-объявления и т.д.);
наследуют все права USER. MODERATOR и ADMIN — операторские роли.

## Принципы
- **Запрет по умолчанию.** Никаких прав без явной выдачи (least privilege).
- **Двухслойное применение.** Грубая проверка роли в guard-слое; **объектная проверка владения** в сервис-слое (defense in depth).
- **Владение = актор владеет агрегатом** (напр. `animal.owner_id == user.id` или через `organization_users` для
  org-владения); MODERATOR/ADMIN обходят владение только в рамках своей операторской области.

## Матрица (C=create, R=read, U=update, D=delete/деактивация; `own`=только свои; `—`=запрещено)

| Ресурс | USER (+breeder/farmer/vet/groomer) | MODERATOR | ADMIN |
|---|---|---|---|
| **Auth/сессия** (register, login, refresh, logout) | C/own | C/own | C/own |
| **Свой профиль** | R/U/D own | R/U own | R/U/D any |
| **Чужие профили** | R (публичные поля) | R (полные) | R/U/D |
| **Роли/статус пользователя (suspend)** | — | suspend/unsuspend (по модерации) | C/R/U/D |
| **Животные** | C/R/U/D own | R any | R/U/D any |
| **Передача владения животным** | инициировать/подтвердить own (в MVP заблокировано) | R | R/U |
| **Объявления** | C/R/U/D own (R любые активные) | R any (вкл. pending) | R/U/D any |
| **Решение модерации по объявлению** | — | C (approve/reject/changes) | C |
| **Очередь модерации** | — | R | R |
| **Жалобы на контент** | C/own, R own | R/U (resolve) | R/U/D |
| **Беседы/сообщения** (Фаза 2+) | C/R own | R (для модерации) | R |
| **Организации / филиалы** | R; C/U/D если org-admin (`organization_users.role_in_org`) | R | C/R/U/D |
| **Членство в организации** | управлять если org-admin | R | C/R/U/D |
| **Справочники** (species, breeds, cities) | R | R | C/R/U/D |
| **Feature toggles / системный конфиг** | — | — | C/R/U/D |
| **Шаблоны уведомлений** | — | — | C/R/U/D |
| **Уведомления (свои)** | R own, управление prefs | R own | R any |
| **Платежи / возвраты** (Фаза 2+, gated) | C/R own | R | R/U (refund) |
| **Цифровые активы / NFT** (Фаза 2+, gated) | R own | R | R/U |
| **Журнал аудита** | — | R (свои действия) | R all |
| **Избранное / сохранённые поиски** | C/R/U/D own | own | own |

## Правила объектного уровня (владение) — применять в сервис-слое
- **Животное:** изменяемо только `owner_id == актор` ИЛИ актор — org-admin `organization_id`. Неизменяемые поля
  (species_id, sex, date_of_birth, breed_id) блокируются триггером независимо от роли.
- **Объявление:** изменяемо только `seller_id == актор` ИЛИ org-admin его `organization_id`.
- **Беседа/сообщение:** видимы только `participant_a_id`/`participant_b_id` (+ MODERATOR для ревью).
- **Жалоба:** заявитель видит свои; MODERATOR/ADMIN видят все.
- **Платёж:** пользователь видит только свои `payment_transactions.user_id == актор`.
- **MODERATOR/ADMIN обходят** владение только в рамках области выше — никогда молча для несвязанных записей.

## Замечания по реализации
- Кодировать как CASL `defineAbilitiesFor(user)`; один набор abilities на роль, композиция (BREEDER = USER + extras).
- `RolesGuard` читает `x-required-roles` (`@Roles()`); `PoliciesGuard` проверяет объектный уровень по загруженному ресурсу.
- Публичные (без auth): register/login/refresh, чтение активных объявлений, geo-search/geocode, чтение справочников.
  Всё остальное требует валидный JWT.

## Связанное
- [Спецификация безопасности](security_specification.md) · [ADR-0001](../../04-decisions/0001-tech-stack.md) ·
  [Домен Identity](../01-identity-domain.md) · [Домен Admin](../06-admin-domain.md)
- 🌐 EN: [docs/specs/security/rbac-matrix.md](../../../docs/specs/security/rbac-matrix.md)
