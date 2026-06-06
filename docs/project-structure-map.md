# Project Structure Map (SDD)

**Последнее обновление:** 2026-06-06
**Версия документа:** 1.1
**Статус:** Living Document

## 1. Общая архитектура проекта
ZooLink — это платформа для связи зоопарков, приютов, организаций и частных лиц, aimed at facilitating animal adoption, livestock trading, and pet marketplace activities. The project follows a modular architecture separating concerns into domains such as Identity, Animal, Organization, Branch, Listings, Matching, Admin, Geo-search, and Frontend. Documentation, specifications, and architectural decisions are stored in the `docs/` hierarchy, while API contracts reside in a separate `03-architecture/` folder at the repository root. The database schema is defined in `database_schema.sql` with accompanying ERD diagrams.

## 2. Корневая структура проекта (полное дерево)
Ниже показана рекурсивная структура проекта от корня, исключая служебные каталоги Git и IDE, а также большие бинарные файлы (если они есть). Для читаемости глубина показана с отступами.

```bash
/home/asulimenko/Project/ZooLink
├── .github/
│   └── workflows/
│       └── performance-tests.yml
├── 03-architecture/
│   └── api-contracts/
│       ├── admin-api.yaml
│       ├── animals-api.yaml
│       ├── auth-api.yaml
│       ├── branch-api.yaml
│       ├── listings-api.yaml
│       ├── matching-api.yaml
│       └── organization-api.yaml
├── ANALYSIS_PROFESSIONAL_USERS.md
├── ANALYSIS_PROFESSIONAL_USERS_RU.md
├── bottom_part.md
├── checklists/
│   ├── ACCURACY_FIX_CHECKLIST.md
│   ├── API-TECH-STACK-CHECKLIST.md
│   ├── DOCUMENTATION_CHECKLIST.md
│   └── FURTHER_IMPLEMENTATION_CHECKLIST.md
├── database_schema.sql
├── docs/
│   ├── 00-project-brief.md
│   ├── 01-discovery/
│   │   ├── assumptions.md
│   │   ├── future-features.md
│   │   ├── mvp-scope.md
│   │   ├── problem-statement.md
│   │   └── target-audience.md
│   ├── 02-requirements/
│   │   ├── business-requirements/
│   │   │   ├── admin-domain.md
│   │   │   ├── animal-domain.md
│   │   │   ├── identity-domain.md
│   │   │   ├── livestock-marketplace.md
│   │   │   ├── matching-domain.md
│   │   │   ├── organization-domain.md
│   │   │   └── pet-marketplace.md
│   │   ├── integrations.md
│   │   └── nfr/
│   │       ├── accessibility.md
│   │       ├── performance.md
│   │       └── security.md
│   ├── 03-architecture/
│   │   ├── context.svg
│   │   └── system-context.md
│   ├── 04-decisions/
│   │   └── 0001-tech-stack.md
│   ├── project-structure-map.md
│   ├── README.md
│   └── specs/
│       ├── 01-identity-domain.md
│       ├── 02-animal-domain.md
│       ├── 03-pet-marketplace-domain.md
│       ├── 04-livestock-marketplace-domain.md
│       ├── 05-matching-domain.md
│       ├── 06-admin-domain.md
│       ├── 07-geo-search-service.md
│       ├── 08-frontend-architecture.md
│       ├── 09-testing-strategy.md
│       ├── 10-implementation-roadmap.md
│       ├── glossary.md
│       ├── README.md
│       ├── security/
│       │   └── threat-model.md
│       └── traceability Matrix.md
├── docsRU/
│   ├── 00-project-brief.md
│   ├── 01-discovery/
│   │   ├── assumptions.md
│   │   ├── future-features.md
│   │   ├── mvp-scope.md
│   │   ├── problem-statement.md
│   │   └── target-audience.md
│   ├── 02-requirements/
│   │   ├── business-requirements/
│   │   │   ├── admin-domain.md
│   │   │   ├── animal-domain.md
│   │   │   ├── identity-domain.md
│   │   │   ├── livestock-marketplace.md
│   │   │   ├── matching-domain.md
│   │   │   ├── organization-domain.md
│   │   │   └── pet-marketplace.md
│   │   ├── integrations.md
│   │   └── nfr/
│   │       ├── accessibility.md
│   │       ├── performance.md
│   │       └── security.md
│   ├── 03-architecture/
│   │   ├── context.svg
│   │   └── system-context.md
│   ├── 04-decisions/
│   │   └── 0001-tech-stack.md
│   ├── README.md
│   └── specs/
│       ├── 01-identity-domain.md
│       ├── 02-animal-domain.md
│       ├── 03-pet-marketplace-domain.md
│       ├── 04-livestock-marketplace-domain.md
│       ├── 05-matching-domain.md
│       ├── 06-admin-domain.md
│       ├── 07-geo-search-service.md
│       ├── 08-frontend-architecture.md
│       ├── 09-testing-strategy.md
│       ├── 10-implementation-roadmap.md
│       ├── glossary.md
│       ├── README.md
│       ├── security/
│       │   └── threat-model.md
│       └── traceability Matrix.md
├── ERD_DESCRIPTION.md
├── .idea/
│   ├── .gitignore
│   ├── modules.xml
│   ├── vcs.xml
│   ├── workspace.xml
│   └── ZooLink.iml
├── tests/
│   └── performance/
│       # ( директория для скриптов нагрузочного тестирования; в зависимости от потребностей можно добавить файлы )
├── top28.md
├── top_part.md
└── ZooLink_ERD.mmd
```

> Примечание: папка `documentation/checklists` была перемещена в корневой `checklists/` и более не используется; оставлена пустой для возможного будущего использования.

## 3. Детальная карта с описаниями (основной раздел)
*(Кратко, как требуется в шаблоне SDD; детали см. в полном дереве выше)*

### `/` (Root)
- **Назначение:** Корневой каталог репозитория, содержащий документацию, схемы базы данных, конфигурационные файлы и вспомогательные материалы.
- **Глубина вложенности:** 0
- **Ключевые файлы и папки:**
  - `03-architecture/` – спецификации API-контрактов и архитектурные артефакты.
  - `docs/` – основная документация на английском языке (требования, архитектура, решения, спецификации).
  - `docsRU/` – дубликат документации на русском языке.
  - `checklists/` – чек-листы для обеспечения качества и соблюдения процессов.
  - `database_schema.sql` – SQL-скрипт создания схемы базы данных ZooLink.
  - `ERD_DESCRIPTION.md` – описание entity-relationship диаграммы.
  - `ZooLink_ERD.mmd` – исходный файл диаграммы в формате Mermaid.
  - `.git/` – метаданные репозитория Git.
  - `.idea/` – настройки IDE (IntelliJ/WebStorm).
  - Прочие markdown-файлы (`top_part.md`, `bottom_part.md`, `top28.md`, `ANALYSIS_PROFESSIONAL_USERS*.md`) – вспомогательные материалы.

### `/docs/`
- **Назначение:** Главная папка документации на английском языке, структурированная по методам Spec-Driven Documentation (SDD).
- **Глубина вложенности:** 1
- **Ключевые файлы и папки:** см. дерево выше (00-project-brief.md, 01-discovery/, 02-requirements/, 03-architecture/, 04-decisions/, README.md, specs/).

## 4. Почему `project-structure-map.md` находится в `docs/`, а не в корне проекта
В методологии Spec-Driven Documentation (SDD) основной артефакт – живая документация проекта, включающая спецификации, архитектурные решения и карты структуры. Все документы, касающиеся описания проекта (требования, спецификации, ADR, карты структуры) размещаются в папке `docs/`, чтобы разделить **артефакты реализации** (исходный код, API-контракты, схемы БД) от **артефакта документации**. Такое разделение упрощает навигацию, позволяет четко определить, что является «живой документацией», а что — кодом и конфигурацией. Кроме того, многие инструменты документирования ожидают найти таких файлов в dedicated папке docs/.

## 5. Правила и соглашения по именованию и структуре
- Файлы документации используют расширение `.md` (Markdown).
- Имена файлов и папок преимущественно в kebab-case (например, `api-tech-stack-checklist.md`, `animal-domain.md`).
- Внутри папок `docs/` используется иерархическая нумерация для указания этапов и разделов (например, `02-requirements/`, `03-architecture/`).
- Спецификации доменов имеют префикс с двухзначным номером и названия в kebab-case (e.g., `02-animal-domain.md`).
- Архитектурные решения (ADR) помещаются в `docs/04-decisions/` с четырехзначным префиксом и заголовком (например, `0001-tech-stack.md`).
- Диаграммы хранятся в соответствующих форматах: `.svg` для векторных, `.mmd` для Mermaid-моделей.
- API-контракты расположены в отдельной папке `03-architecture/` на корневом уровне, вероятно, используют YAML/OpenAPI или protobuf.
- SQL-файлы имеют явное расширение `.sql` и содержать DDL-скрипты.

## 6. Зоны ответственности модулей
| Домен / Модуль | Где хранятся спецификации | Где хранятся API-контракты | Где хранятся таблицы БД |
|----------------|---------------------------|----------------------------|--------------------------|
| Identity | `docs/02-requirements/identity-domain.md`, `docs/specs/01-identity-domain.md` | `03-architecture/api-contracts/` (`identity-api.yaml` – если существует) | Таблицы `users` |
| Animal | `docs/02-requirements/animal-domain.md`, `docs/specs/02-animal-domain.md` | `03-architecture/api-contracts/` (`animals-api.yaml`) | Таблицы `animals`, `species`, `breeds` |
| Organization | `docs/02-requirements/organization-domain.md` | `03-architecture/api-contracts/` (`organization-api.yaml`) | Таблицы `organizations`, `branches` |
| Branch | `docs/02-requirements/organization-domain.md` (филиалы организаций) | `03-architecture/api-contracts/` (`branch-api.yaml`) | Таблица `branches` |
| Listings (объявления) | `docs/02-requirements/livestock-marketplace.md`, `docs/02-requirements/pet-marketplace.md`, `docs/specs/03-pet-marketplace-domain.md`, `docs/specs/04-livestock-marketplace-domain.md` | `03-architecture/api-contracts/` (`listings-api.yaml`) | Таблицы `listings`, `listing_photos` |
| Matching | `docs/02-requirements/matching-domain.md`, `docs/specs/05-matching-domain.md` | `03-architecture/api-contracts/` (`matching-api.yaml`) | Таблицы `matches` (если есть) |
| Admin | `docs/02-requirements/admin-domain.md`, `docs/specs/06-admin-domain.md` | `03-architecture/api-contracts/` (`admin-api.yaml`) | Таблицы `feature_toggles`, `outbox_events` |
| Geo-search | `docs/specs/07-geo-search-service.md` | `03-architecture/api-contracts/` (`geo-search-api.yaml` – если существует) | Расширения БД для геопространственных индексов (PostGIS) |
| Frontend | `docs/specs/08-frontend-architecture.md` | N/A (спецификация frontends) | N/A |
| Тестирование | `docs/specs/09-testing-strategy.md` | N/A | N/A |
| Дорожная карта реализации | `docs/specs/10-implementation-roadmap.md` | N/A | N/A |

## 7. История значимых изменений структуры
| Дата | Изменение | Причина |
|------|-----------|---------|
| 2026-05-31 | Создан файл `docs/project-structure-map.md` (и обновлен с полным деревом) | Необходимость документировать структуру проекта в соответствии с методологией SDD |
| 2026-05-31 | Добавлены чек-листы в папку `checklists/` (ACCURACY_FIX_CHECKLIST.md, API-TECH-STACK-CHECKLIST.md, DOCUMENTATION_CHECKLIST.md, FURTHER_IMPLEMENTATION_CHECKLIST.md) | Обеспечение качества и следование процессам |
| 2026-05-30 | Обновлен `database_schema.sql` (добавлены комментарии и ограничения) | Улучшение документирования схемы БД |
| 2026-05-30 | Создан/обновлен `ZooLink_ERD.mmd` и `ERD_DESCRIPTION.md` | Визуализация и описание структуры базы данных |
| 2026-05-29 | Добавлена документация по доменам в `docs/specs/` и `docs/02-requirements/` | Уточнение требований и спецификаций по доменам |
| 2026-05-28 | INITIAL commit с базовой структурой и папкой `03-architecture/` для API-контрактов | Инициализация репозитория проекта |
| 2026-06-06 | Обновлено дерево структуры проекта, добавлены новые файлы и каталоги (.github/workflows/performance-tests.yml, tests/performance/, обновлённые yaml‑контракты и glossary) | Соответствие актуальному состоянию репозитория после выполнения рекомендаций senior‑business‑analyst |

> `project-structure-map.md` обновлён.

## 8. Как поддерживать карту структуры в актуальном состоянии
Чтобы гарантировать, что данная карта всегда отражает текущее состояние репозитория, предлагается следовать одному из следующих лёгких подходов:

1. **Префукс коммита**: перед созданием нового файла или каталога, добавить в коммит сообщение `[STRUCTURE_UPDATE]` и после коммита запустить скрипт, который автоматически генерирует дерево и заменяет блок с \`\`\`bash ... \`\`\` в этом файле.
2. **Пре-коммит хук**: установить простой pre‑commit hook (например, через `pre-commit` фреймворк), который при каждом коммите проверяет, изменились ли какие‑либо файлы в репозитории (исключая docs/ и временные файлы) и, если изменения обнаружены, обновляет проект‑структуру в `docs/project-structure-map.md`.
3. **Напоминание в чек‑листе Definition of Done**: добавить пункт в `Definition of Done` (см. `docs/specs/10-implementation-roadmap.md`): «Обновить `docs/project-structure-map.md`, если были добавлены, удалены или переименованы файлы/каталоги, влияющие на структуру проекта».

Выбранный механизм можно оформить как отдельный скрипт `scripts/update-structure-map.sh`, который использует команду `find . -type f -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./.*" | sort` и формирует вывод в стиле дерева, заменяя соответствующий раздел в файле.

Эти шаги помогут поддерживать живую документацию в синхроне с кодовой базой без значительных нагрузок на разработчиков.