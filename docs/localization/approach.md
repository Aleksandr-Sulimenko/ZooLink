# Localization approach in the ZooLink project

## Chosen solution: Enhanced JSONB approach

After analyzing various approaches to localization in relational databases, the enhanced JSONB approach was chosen for the ZooLink project. This solution is an evolution of the project's current implementation, while preserving the simplicity of development and maintenance.

### Why the JSONB approach?

1. **Matches the current implementation** - the project already uses the JSONB approach for localization, which minimizes the need to refactor the existing code
2. **Simplicity of development and maintenance** - a familiar approach for the development team
3. **Good read performance** - all localization data is available in a single query without the need for JOINs
4. **Easy to add new languages** - does not require DB schema changes when adding new languages
5. **Flexibility** - different types of localizable data can be stored in a single format
6. **Indexability** - PostgreSQL provides excellent tools for indexing JSONB fields
7. **Compliance with modern practices** - widely used in the industry for similar tasks

### What are we improving in the current implementation?

#### 1. Standardizing the JSONB structure
We introduce a single format for all localizable fields:
```json
{
  "ru": "значение на русском",
  "en": "значение на английском",
  "fr": "",
  "es": "",
  "zh": ""
}
```

Advantages:
- A single format simplifies working with the data
- A clear distinction between an empty translation and a missing key
- The ability to determine which languages are supported by the application via configuration

#### 2. Adding helper functions in the database
We create SQL functions to simplify working with localized data:

```sql
-- Function to get a translation in the specified language with a fallback
CREATE OR REPLACE FUNCTION get_localized(
    data JSONB,
    lang TEXT DEFAULT current_setting('app.current_language', true),
    fallback_lang TEXT DEFAULT 'en'
) RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        data->>lang,
        data->>fallback_lang,
        ''  -- final fallback
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check whether a translation exists
CREATE OR REPLACE FUNCTION has_translation(
    data JSONB,
    lang TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN (data->>lang) IS NOT NULL AND (data->>lang) <> '';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

#### 3. Indexing for performance
We add GIN indexes for efficient search across translations:
```sql
-- Index for searching organizations by name in a specific language
CREATE INDEX idx_organizations_name_localized_en 
ON organizations USING GIN ((name_localized -> 'en'));

CREATE INDEX idx_organizations_name_localized_ru 
ON organizations USING GIN ((name_localized -> 'ru'));

-- Similarly for other fields and tables
```

#### 4. Managing supported languages
We create a supported-languages table for centralized management:
```sql
CREATE TABLE supported_languages (
    code CHAR(2) PRIMARY KEY,  -- ISO 639-1 language code
    name_localized JSONB NOT NULL,  -- localized name of the language
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 5. Fallback mechanism and default language
We implement it at the application level:
- We set the session language via `SET app.current_language = 'ru';`
- We use a predefined fallback language (for example, 'en')
- Logic: requested language → fallback → default language → empty string

### How does this comply with standards and best practices?

#### Compliance with GOST and international standards:
- Supports the principle of making information available in the official languages of the Russian Federation (Russian) and in languages of international communication (English)
- Provides the ability to extend support to additional languages in accordance with localization requirements
- Allows cultural and linguistic specifics to be preserved through high-quality translations

#### Modern approaches to i18n:
- Uses the de-facto industry standard (JSONB in PostgreSQL) for storing multilingual data
- Complies with the "single source of truth" principle when fallback mechanisms are implemented correctly
- Supports the "default language + translations" approach, which is widely recognized as effective
- Provides separation of presentation and data through layers of abstraction

## Implementation plan

The localization improvements will be implemented in phases:

### Phase 1: Standardization and basic improvements
- Bringing all JSONB localization fields to a single format
- Adding helper functions in the database (`get_localized`, `has_translation`, `set_app_language`)
- Creating the `supported_languages` table
- Adding comments and documentation to the DB schemas

### Phase 2: Performance optimization
- Analysis of the most frequent queries against localized data
- Adding targeted GIN indexes for frequently used languages and fields
- Considering materialized views for complex composite queries

### Phase 3: Improving translation quality
- Introducing mechanisms for tracking incomplete translations
- Adding an administrative interface for managing translations
- Introducing CI/CD-stage checks for the presence of required translations

### Phase 4: Extending functionality (as needed)
- Considering a switch to a hybrid approach for critical fields with a high update frequency
- Introducing translation versioning mechanisms if an audit of changes is needed
- Considering integration with machine translation systems for pre-filling

## Expected results

After implementing the improvements we will obtain:
1. A standardized and easily extensible localization system
2. Improved read and search performance over localized data
3. Simplified handling of localization at the application level thanks to helper functions
4. Centralized management of supported languages
5. Readiness to easily add new languages without DB schema changes
6. Compliance with modern standards and best practices in the area of i18n/l10n

This solution optimally balances extensibility requirements, performance, and ease of implementation, which is especially important for a mid-sized project such as ZooLink.
