# Localization Specification - ZooLink

## Overview
This document specifies the localization (i18n/l10n) requirements, implementation approach, and quality standards for the ZooLink system. It defines the approach for supporting multiple languages, managing translations, and ensuring a consistent user experience across different locales.

## Localization Goals & Requirements

### Supported Languages
| Language | Code | Status | Condition |
|----------|------|--------|-----------|
| **Russian** | ru | Primary language | Official language of the Russian Federation |
| **English** | en | Secondary language | International language for broader accessibility |
| **Future Languages** | fr, es, zh, etc. | Planned for Фаза 2+ | Based on user demand and market expansion |

### Core Localization Principles
1. **Single Source of Truth**: All localizable data stored in centralized JSONB fields
2. **Fallback Mechanism**: Hierarchical language fallback (requested → fallback → default → empty)
3. **Performance Optimization**: Efficient querying and indexing of localized data
4. **Quality Assurance**: Mandatory translations for primary languages in released features
5. **Extensibility**: Easy addition of new languages without schema changes

### Data Model Requirements
- **JSONB Structure**: Standardized format for all localizable fields
  ```json
  {
    "ru": "значение на русском",
    "en": "значение на английском",
    "fr": "",
    "es": "",
    "zh": ""
  }
  ```
- **Empty Strings vs Missing Keys**: Distinction between intentionally empty translations and missing keys
- **Language Configuration**: Supported languages managed via database table

### Functional Requirements
1. **Content Localization**: All user-facing text must be localizable
2. **Dynamic Language Switching**: Users can change interface language without page reload
3. **Persisted Language Preference**: User language preference stored in profile/session
4. **Database-Level Localization Functions**: SQL functions for retrieving and checking translations
5. **Search and Filtering**: Ability to search and filter by localized content
6. **Administrative Translation Management**: Interface for managing translations

### Non-Functional Requirements
- **Performance**: Localized queries should not degrade performance significantly
- **Scalability**: System should support addition of new languages without downtime
- **Maintainability**: Clear separation between localizable content and code
- **Consistency**: Uniform approach to localization across all modules

## Implementation Approach

### Enhanced JSONB Approach
We have selected an improved JSONB-based approach for localization, building upon the current implementation.

#### 1. Standardized JSONB Structure
All localizable fields will follow a uniform JSONB structure with language codes as keys.

#### 2. Database Helper Functions
We will implement SQL functions to simplify working with localized data:

```sql
-- Function for getting translation with fallback
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

-- Function for checking translation existence
CREATE OR REPLACE FUNCTION has_translation(
    data JSONB,
    lang TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN (data->>lang) IS NOT NULL AND (data->>lang) <> '';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

#### 3. Performance Optimization
We will add targeted GIN indexes for efficient querying:

```sql
-- Example index for organization names
CREATE INDEX idx_organizations_name_localized_en 
ON organizations USING GIN ((name_localized -> 'en'));

CREATE INDEX idx_organizations_name_localized_ru 
ON organizations USING GIN ((name_localized -> 'ru'));
```

#### 4. Language Management
We will create a table for managing supported languages:

```sql
CREATE TABLE supported_languages (
    code CHAR(2) PRIMARY KEY,  -- ISO 639-1 language code
    name_localized JSONB NOT NULL,  -- localized language name
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 5. Application-Level Fallback
Language resolution will follow this hierarchy:
1. Requested language (from user preferences/session)
2. Fallback language (configured, e.g., 'en')
3. Default language (system default)
4. Empty string (if no translation available)

## Localization Quality Standards

### Translation Completeness
- **Mandatory Languages**: Russian and English must have 100% translation coverage for all released features
- **Optional Languages**: Other languages may have partial coverage with clear indication of missing translations
- **Fallback Behavior**: Missing translations fall back to the next language in the chain

### Translation Accuracy
- **Professional Translation**: All translations should be performed by qualified linguists
- **Technical Terminology**: Industry-standard terms should remain untranslated (e.g., UUID, JSONB, API)
- **Context Preservation**: Translators should receive context about UI elements and character limits
- **Review Process**: All translations should undergo proofreading and quality assurance

### Format Consistency
- **JSONB Validity**: All localized fields must contain valid JSONB
- **Key Consistency**: All localized fields for a given entity should support the same set of languages
- **Encoding**: UTF-8 encoding for all text content
- **Escaping**: Proper escaping of special characters in JSON strings

## Localization Testing Scenarios

### Functional Testing
- **Language Switching**: Verify users can switch languages and see immediate updates
- **Fallback Behavior**: Test fallback chains when translations are missing
- **Dynamic Content**: Validate localization of dynamically loaded content
- **Form Labels and Placeholders**: Ensure all form elements are properly localized
- **Error Messages**: Verify error messages appear in the selected language
- **Date and Number Formatting**: Confirm locale-specific formatting of dates, numbers, and currencies

### Performance Testing
- **Query Performance**: Measure response times for queries involving localized fields
- **Index Usage**: Verify GIN indexes are being used for localized search queries
- **Caching Efficiency**: Test effectiveness of any translation caching mechanisms
- **Concurrent Users**: Validate localization performance under expected user load

### Quality Assurance Testing
- **Translation Completeness**: Automated checks for missing translations in mandatory languages
- **Format Validation**: Verify all JSONB fields are valid and properly structured
- **Consistency Checks**: Ensure consistent terminology across related UI elements
- **Character Limit Validation**: Confirm translations fit within allocated UI space
- **Special Character Handling**: Test proper display of accents, symbols, and special characters

## Localization Optimization Roadmap

### MVP (Фаза 1)
- Standardized JSONB structure for all localizable fields
- Database helper functions (`get_localized`, `has_translation`)
- Basic language management table (`supported_languages`)
- Application-level language fallback mechanism
- Initial set of supported languages: Russian (ru) and English (en)
- Basic indexing for performance optimization

### Фаза 2 (Growth)
- Advanced caching strategy for frequently accessed translations
- Administrative interface for managing translations
- Translation completeness checks in CI/CD pipeline
- Additional language support based on user demand (French, Spanish, etc.)
- Enhanced search capabilities across multiple languages
- Machine translation integration for preliminary translations

### Фаза 3 (Maturity)
- Context-aware translation management (different translations for different contexts)
- Translation memory and reuse systems
- Advanced linguistic features (pluralization, gender-specific translations)
- Real-time collaboration tools for translators
- Continuous localization flow integrated with development process
- Analytics on language usage and translation effectiveness

## References
- PostgreSQL JSONB Documentation
- ISO 639-1 Language Codes
- RFC 5646 - Tags for Identifying Languages
- Unicode Common Locale Data Repository (CLDR)
- W3C Internationalization (i18n) Activity
- Globalization and Localization Association (GALA) Best Practices
- Microsoft Localization Guidance
- Google Material Design Localization Guidelines
- Apple Internationalization and Localization Guide