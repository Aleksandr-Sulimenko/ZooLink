# Project Structure Map (SDD)

**Последнее обновление:** 2026-05-31 16:50
**Версия документа:** 1.0
**Статус:** Living Document

## 1. Общая архитектура проекта
ZooLink — это платформа для связи зоопарков, приютов, организаций и частных лиц, aimed at facilitating animal adoption, livestock trading, and pet marketplace activities. The project follows a modular architecture separating concerns into domains such as Identity, Animal, Organization, Branch, Listings, Matching, Admin, Geo-search, and Frontend. Documentation, specifications, and architectural decisions are stored in the `docs/` hierarchy, while API contracts reside in a separate `03-architecture/` folder at the repository root. The database schema is defined in `database_schema.sql` with accompanying ERD diagrams.

## 2. Корневая структура проекта
```bash
/home/asulimenko/Project/ZooLink
├── 03-architecture/
├── ANALYSIS_PROFESSIONAL_USERS.md
├── ANALYSIS_PROFESSIONAL_USERS_RU.md
├── bottom_part.md
├── checklists/
├── database_schema.sql
├── docs/
├── docsRU/
├── documentation/
├── ERD_DESCRIPTION.md
├── .git/
├── .idea/
├── top_part.md
├── top28.md
└── ZooLink_ERD.mmd
```

## 3. Детальная карта с описаниями (основной раздел)

### `/` (Root)
- **Назначение:** Корневой каталог репозитория, содержащий документацию, схемы базы данных, конфигурационные файлы и вспомогательные материалы.
- **Глубина вложенности:** 0
- **Ключевые файлы и папки:**
  - `03-architecture/` – спецификации API-контрактов и архитектурные артефакты (см. ниже).
  - `docs/` – основная документация на английском языке (требования, архитектура, решения, спецификации).
  - `docsRU/` – дубликат документации на русском языке.
  - `checklists/` – чек-листы для обеспечения качества и соблюдения процессов (точность, стек технологий, документация, дальнейшая реализация).
  - `documentation/` – дополнительная документация, возможно, генерированные руководства.
  - `database_schema.sql` – SQL-скрипт создания схемы базы данных ZooLink.
  - `ERD_DESCRIPTION.md` – описание entity-relationship диаграммы.
  - `ZooLink_ERD.mmd` – исходный файл диаграммы в формате Mermaid.
  - `ANALYSIS_PROFESSIONAL_USERS.md` и его русская версия – анализ профессиональных пользователей.
  - `top_part.md`, `bottom_part.md`, `top28.md` – фрагменты документации или шаблоны.
  - `.git/` – метаданные репозитория Git.
  - `.idea/` – настройки IDE (IntelliJ/WebStorm).

### `/docs/`
- **Назначение:** Главная папка документации на английском языке, структурированная по методам Spec-Driven Documentation (SDD).
- **Глубина вложенности:** 1
- **Ключевые файлы и папки:**
  - `00-project-brief.md` – краткое описание проекта, цели, заинтересованные стороны.
  - `01-discovery/` – этап открытия: предположения, будущие функции, MVP, проблематика, целевая аудитория.
  - `02-requirements/` – бизнес-требования, разделенные по доменам (Identity, Animal, Organization, Livestock Marketplace, Matching, Pet Marketplace, Admin) и нефункциональные требования (доступность, производительность, безопасность).
  - `03-architecture/` – архитектурные артефакты: контекстная диаграмма (system-context.md, context.svg).
  - `04-decisions/` – архитектурные решения (ADR), например, выбор технологического стека.
  - `README.md` – обзор документационной структуры.
  - `specs/` – детальные спецификации по доменам и техническим аспектам:
    - `01-identity-domain.md`
    - `02-animal-domain.md`
    - `03-pet-marketplace-domain.md`
    - `04-livestock-marketplace-domain.md`
    - `05-matching-domain.md`
    - `06-admin-domain.md`
    - `07-geo-search-service.md`
    - `08-frontend-architecture.md`
    - `09-testing-strategy.md`
    - `10-implementation-roadmap.md`
    - `glossary.md`
    - `security/` – модель угроз (threat-model.md)
    - `traceability Matrix.md` – матрица прослеживаемости требований.

### `/docs/02-requirements/`
- **Назначение:** Бизнес-требования и нефункциональные требования, organised by domain.
- **Глубина вложенности:** 2
- **Ключевые файлы и папки:**
  - `business-requirements/` – подпапка с требованиями по доменам:
    - `admin-domain.md`
    - `animal-domain.md`
    - `identity-domain.md`
    - `livestock-marketplace.md`
    - `matching-domain.md`
    - `organization-domain.md`
    - `pet-marketplace.md`
  - `integrations.md` – описания внешних интеграций.
  - `nfr/` – нефункциональные требования:
    - `accessibility.md`
    - `performance.md`
    - `security.md`

### `/docs/03-architecture/`
- **Назначение:** Архитектурное описание системы на высоком уровне.
- **Глубина вложенности:** 2
- **Ключевые файлы и папки:**
  - `system-context.md` – textual description of system context.
  - `context.svg` – диаграмма контекста системы в формате SVG.

### `/docs/04-decisions/`
- **Назначение:** Архитектурные решения (Architecture Decision Records, ADR).
- **Глубина вложенности:** 2
- **Ключевые файлы и папки:**
  - `0001-tech-stack.md` – запись о выбранном технологическом стеке.

### `/docs/specs/`
- **Назначение:** Детальные функциональные спецификации по каждому домену и техническим аспектам.
- **Глубина вложенности:** 2
- **Ключевые файлы:**
  - См. список выше в разделе `/docs/`.

### `/03-architecture/` (корневой уровень)
- **Назначение:** Контракты API и связанная документация (OpenAPI/Swagger, protobuf, etc.) для микросервисов ZooLink.
- **Глубина вложенности:** 1
- **Ключевые файлы и папки:** (содержимое не показано в выводе, но папка существует; предполагается, что здесь находятся файлы API-контрактов, например, `openapi.yaml`, `proto/` и т.д.)

### `/checklists/`
- **Назначение:** Списки проверок для обеспечения качества и соблюдения процессов.
- **Глубина вложенности:** 1
- **Ключевые файлы:**
  - `ACCURACY_FIX_CHECKLIST.md` – проверка точности данных.
  - `API-TECH-STACK-CHECKLIST.md` – проверка выбора API и технологического стека.
  - `DOCUMENTATION_CHECKLIST.md` – проверка completeness документации.
  - `FURTHER_IMPLEMENTATION_CHECKLIST.md` – план дальнейших шагов реализации.

### `/database_schema.sql`
- **Назначение:** Описание схемы базы данных PostgreSQL (или другой СУБД) для ZooLink: таблицы, ограничения, индексы.
- **Глубина вложенности:** 0
- **Ключевые детали:** Создаёт домены для животных, организаций, объявлений, пользователей и т.д.

### `/ERD_DESCRIPTION.md`
- **Назначение:** Текстовое описание entity-relationship диаграммы ZooLink.
- **Глубина вложенности:** 0

### `/ZooLink_ERD.mmd`
- **Назначение:** Исходный код диаграммы ERD в формате Mermaid для визуализации структуры БД.
- **Глубина вложенности:** 0

## 4. Правила и соглашения по именованию и структуре
- Файлы документации используют расширение `.md` (Markdown).
- Имена файлов и папок преимущественно в kebab-case (например, `api-tech-stack-checklist.md`, `animal-domain.md`).
- Внутри папок `docs/` используется иерархическая нумерация для указания этапов и разделов (например, `02-requirements/`, `03-architecture/`).
- Спецификации доменов имеют префикс с двухзначным номером и названия в kebab-case (e.g., `02-animal-domain.md`).
- Архитектурные решения (ADR) помещаются в `docs/04-decisions/` с пятнадцатиразрядным префиксом и заголовком (например, `0001-tech-stack.md`).
- Диаграммы хранятся в соответствующих форматах: `.svg` для векторных, `.mmd` для Mermaid-моделей.
- API-контракты расположены в отдельной папке `03-architecture/` на корневом уровне, вероятно, используют YAML/OpenAPI или protobuf.
- SQL-файлы имеют явное расширение `.sql` и содержать DDL-скрипты.

## 5. Зоны ответственности модулей
| Домен / Модуль | Где хранятся спецификации | Где хранятся API-контракты | Где хранятся таблицы БД |
|----------------|---------------------------|----------------------------|--------------------------|
| Identity | `docs/02-requirements/identity-domain.md`, `docs/specs/01-identity-domain.md` | `03-architecture/` (возможно, `identity-api.yaml`) | Таблицы `users`, `roles`, `permissions` в `database_schema.sql` |
| Animal | `docs/02-requirements/animal-domain.md`, `docs/specs/02-animal-domain.md` | `03-architecture/` (animal-api.yaml) | Таблицы `animals`, `species`, `breeds` |
| Organization | `docs/02-requirements/organization-domain.md`, `docs/specs/06-admin-domain.md` (частично) | `03-architecture/` (organization-api.yaml) | Таблицы `organizations`, `branches` |
| Branch | `docs/02-requirements/organization-domain.md` (филиалы организаций) | `03-architecture/` (branch-api.yaml) | Таблица `branches` |
| Listings (объявления) | `docs/02-requirements/livestock-marketplace.md`, `docs/02-requirements/pet-marketplace.md`, `docs/specs/04-livestock-marketplace-domain.md`, `docs/specs/03-pet-marketplace-domain.md` | `03-architecture/` (listings-api.yaml) | Таблицы `listings`, `listing_media` |
| Matching | `docs/02-requirements/matching-domain.md`, `docs/specs/05-matching-domain.md` | `03-architecture/` (matching-api.yaml) | Таблицы `matches`, `match_preferences` |
| Admin | `docs/02-requirements/admin-domain.md`, `docs/specs/06-admin-domain.md` | `03-architecture/` (admin-api.yaml) | Таблицы `audit_logs`, `system_settings` |
| Geo-search | `docs/specs/07-geo-search-service.md` | `03-architecture/` (geo-search-api.yaml) | Возможно расширения БД для геопространственных индексов |
| Frontend | `docs/specs/08-frontend-architecture.md` | N/A (спецификация frontends) | N/A |
| Тестирование | `docs/specs/09-testing-strategy.md` | N/A | N/A |
| Дорожная карта реализации | `docs/specs/10-implementation-roadmap.md` | N/A | N/A |

## 6. История значимых изменений структуры
| Дата | Изменение | Причина |
|------|-----------|---------|
| 2026-05-31 | Создан файл `docs/project-structure-map.md` | Необходимость документировать структуру проекта в соответствии с методологией SDD |
| 2026-05-31 | Добавлены чек-листы в папку `checklists/` (ACCURACY_FIX_CHECKLIST.md, API-TECH-STACK-CHECKLIST.md, DOCUMENTATION_CHECKLIST.md, FURTHER_IMPLEMENTATION_CHECKLIST.md) | Обеспечение качества и следование процессам |
| 2026-05-30 | Обновлен `database_schema.sql` (добавлены комментарии и ограничения) | Улучшение документирования схемы БД |
| 2026-05-30 | Создан/обновлен `ZooLink_ERD.mmd` и `ERD_DESCRIPTION.md` | Визуализация и описание структуры базы данных |
| 2026-05-29 | Добавлена документация по доменам в `docs/specs/` и `docs/02-requirements/` | Уточнение требований и спецификаций по доменам |
| 2026-05-28 |_INITIAL commit с базовой структурой и папкой `03-architecture/` для API-контрактов | Инициализация репозитория проекта |

> `project-structure-map.md` обновлён.