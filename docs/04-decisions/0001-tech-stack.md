# ADR 0001: Technology Stack Selection

## Status
Accepted

## Context
We need to select a technology stack for the ZooLink MVP that supports:
- Rapid development and iteration to validate business hypotheses
- Clear separation of concerns aligned with Domain-Driven Design (DDD) bounded contexts
- Scalability for future growth while maintaining simplicity for MVP
- Team familiarity and availability of talent
- Compliance with non-functional requirements (security, performance, maintainability)

## Decision
We will use the following technology stack for the MVP:

### Backend
- **Language**: Node.js (TypeScript)
- **Framework**: NestJS
- **ORM/ODM**: Prisma ORM
- **API Style**: RESTful with OpenAPI 3.0 specification
- **Authentication**: JWT (JSON Web Tokens) with refresh tokens
- **Authorization**: Role-Based Access Control (RBAC) using CASL library for organization/user permissions, implemented via NestJS Guards
- **Real-time capabilities**: Prepared for future WebSocket integration (not used in MVP)

### Frontend
- **Type**: Single Page Application (SPA) with PWA capabilities
- **Framework**: React with TypeScript
- **State Management**: React Context API (for simplicity on MVP) or Zustand
- **UI Library**: Headless UI components with Tailwind CSS for styling
- **Build Tool**: Vite

### Database
- **Primary**: PostgreSQL 14+
- **Cache**: Redis 7+ (for sessions and reference data caching)
- **File Storage**: S3-compatible object storage (MinIO for development, AWS S3 or similar for production)
- **Search**: Built-in PostgreSQL full-text search and geo-indexing (PostGIS considered for Фаза 2+)

### DevOps & Infrastructure
- **Containerization**: Docker
- **Orchestration**: Docker Compose for development, Kubernetes considered for Фаза 2+
- **CI/CD**: GitHub Actions
- **Monitoring**: Promise-based approach with simple logging and metrics (to be enhanced in Фаза 2+)
- **Logging**: Structured JSON logging (Winston or Pino)

### Third-party Integrations
- **SMS**: Twilio (or similar with free tier for MVP)
- **OAuth Providers**: Google, Apple, Telegram, VK (via standard OAuth 2.0 libraries)
- **Geocoding & Maps**: Yandex Maps (free tier) with abstraction layer for easy replacement
- **Email**: SendGrid (or similar) for transactional emails only
- **File Upload**: Pre-signed URLs to S3-compatible storage
- **Localization/i18n**: Format.js for client-side, i18next for React integration, LinguiJS considered for future

## Consequences

### Positive
- **NestJS provides excellent DDD support**: Modules, Dependency Injection, clear separation between Controllers, Services, and Repositories align with bounded contexts
- **TypeScript throughout**: End-to-end type safety reduces bugs and improves developer experience
- **Prisma ORM**: Type-safe database access with excellent DX, easy migrations, and good PostgreSQL support
- **React + Vite**: Fast development builds, excellent performance, and PWA support out-of-the-box
- **PostgreSQL**: Reliable, feature-rich, supports JSONB for extensibility, good GeoIP extensions available
- **Team familiarity**: Stack aligns with common web development skills, reducing onboarding time
- **Scalability potential**: Each layer can be scaled independently (API workers, DB read replicas, cache layer)

### Negative
- **Learning curve**: Team may need to learn NestJS conventions if not experienced
- **Overhead for MVP**: NestJS adds some boilerplate compared to simpler Express.js servers
- **Bundle size**: React apps can have larger bundle sizes (mitigated by code-splitting and lazy loading)
- **PostgreSQL operational overhead**: More complex setup than SQLite (but necessary for production qualities)

### Neutral
- **Vendor lock-in mitigated**: Abstraction layers for SMS, OAuth, mapping, and storage allow provider switching
- **Migration path clear**: Well-defined interfaces between layers allow gradual refactoring if needed

## Implementation Approach
1. **Backend Structure**:
   - `src/modules/` containing domain modules: `identity`, `animal`, `pet-marketplace`, `livestock-marketplace`, `admin`, `moderation`
   - Shared libraries: `src/lib/` (database, auth guards, DTOs, validation)
   - Main application: `src/app.module.ts`

2. **Frontend Structure**:
   - `src/components/` for reusable UI components
   - `src/pages/` for route-based pages
   - `src/hooks/` for custom React hooks
   - `src/lib/` for API clients, utilities, constants
   - `src/styles/` for Tailwind configuration and global styles

3. **Database**:
   - Prisma schema in `prisma/schema.sql` (actually `prisma/schema.prisma`)
   - Migration directory: `prisma/migrations/`
   - Seed data for reference tables (breeds, species, cities)

4. **DevOps**:
   - Docker compose file for local development (backend, frontend, postgres, redis, minio)
   - Separate production compose or Helm charts for Фаза 2+

## Compliance with Requirements
- **Security**: NestJS has built-in validation guards, TypeScript reduces XSS risks, Prisma prevents SQL injection
- **Performance**: NestJS is built on Express (fast), React/Vite optimized builds, PostgreSQL proper indexing
- **Maintainability**: Clear module boundaries, TypeScript self-documenting code, well-tested dependencies
- **Extensibility**: Modular architecture allows adding new domains without disrupting existing ones
- **Team velocity**: Popular stack with excellent documentation and community support

## Alternatives Considered
1. **Ruby on Rails**
   - Pros: Convention over configuration, excellent for MVPs, ActiveRecord ORM
   - Cons: Less common skillset, performance concerns at scale, weaker TypeScript support
   - Rejected due to team familiarity and long-term scaling concerns

2. **Django (Python)**
   - Pros: Excellent ORM, built-in admin, strong security defaults
   - Cons: Python async limitations, less ideal for microservices evolution, ORM less flexible than Prisma for complex queries
   - Rejected due to preference for JavaScript/TypeScript full-stack

3. **Go (Gin/Echo) + React**
   - Pros: Excellent performance, simple deployment, strong concurrency
   - Cons: Lack of established DDD frameworks, weaker ORM options, less frontend integration tooling
   - Rejected due to slower initial development velocity for complex domain modeling

4. **Serverless (AWS Lambda)**
   - Pros: Excellent scaling, pay-per-use
   - Cons: Cold start issues, complex distributed tracing, harder to implement long-running processes, overkill for MVP scale
   - Rejected due to increased complexity and unnecessary scaling for validation phase

5. **Laravel (PHP)**
   - Pros: Mature ecosystem, Eloquent ORM, good for MVC
   - Cons: Perception as legacy stack, less ideal for real-time features evolving, PHP async limitations
   - Rejected due to team preferences and long-term technology trajectory

## Related Documents
- `00-project-brief.md` - constraints and assumptions
- `03-architecture/system-context.md` - high-level system boundaries
- `03-architecture/containers.md` - technical decomposition
- `03-architecture/domains-and-bc.md` - mapping of bounded contexts to technical modules
- `04-decisions/0002-hard-split-markets.md` - rationale for pet/livestock separation

## Localization/Internationalization (i18n) Approach
To support multiple languages (starting with English and Russian, with framework for additional languages):

### UI/UX Localization
- **Library**: Format.js for core internationalization, react-intl for React integration
- **Message Format**: ICU MessageFormat for plurals, gender, and complex formatting
- **Storage**: JSON files per language in `src/locales/` (e.g., `en.json`, `ru.json`)
- **Implementation**: Higher-order component or hook (`useTranslation`) for easy access in components
- **Fallback**: English as default fallback language

### Database Design for Multilingual Content
- **Organizations/Branches**: JSONB `name_localized` and `description_localized` fields with language keys
  ```json
  {
    "name_localized": {"en": "Zoo Name", "ru": "Название Зоопарка"},
    "description_localized": {"en": "A wonderful zoo", "ru": "Прекрасный зоопарк"}
  }
  ```
- **Listings**: JSONB `title_localized` and `description_localized` fields following same pattern
- **Static Content**: Separate `translations` table for UI labels, help text, and validation messages
- **Reference Data**: Species/breed names stored with language keys in JSONB fields

### API Localization Considerations
- **Headers**: Support `Accept-Language` header for language preference
- **Error Messages**: Localized validation and business rule messages
- **Enum Values**: Localized display values for listing types, animal sexes, etc.
- **Response Language**: Either include all translations in response or use `Content-Language` header
- **Consistency**: Ensure API returns localized fields when available, falls back to default language

### Content Management Strategy
- **Documentation**: Maintain parallel `docs/` and `docsRU/` folders with mirrored structure
- **Dynamic Content**: Admin interface for managing translations of user-generated content
- **Translation Workflow**: 
  1. Extract strings during build process
  2. Send to translation team 
  3. Import translated JSON files
  4. Validate completeness and format
- **Versioning**: Track translation completeness per language

### Language Detection & Fallback
- **Priority**: 
  1. User profile language preference
  2. `Accept-Language` header
  3. GeoIP-based detection (with user override)
  4. Default to English
- **Storage**: Save preference in user profile and/or cookie/localStorage
- **Switching**: Language selector in UI persistently saves preference

### Implementation Examples
- **Organization Name**: `<FormattedMessage id="organization.name" defaultMessage={org.name_localized[userLang] || org.name_localized['en']} />`
- **Listing Title**: Access `listing.title_localized[userLang]` or fallback
- **Validation Messages**: Import from locale-specific JSON based on user language
- **API Endpoint**: `GET /api/v1/organizations?lang=ru` or header-based localization

## Notes
This decision will be revisited if:
- Team composition changes significantly
- Performance profiling shows bottlenecks in the chosen stack
- New requirements emerge that are poorly supported by this stack (e.g., need for heavy real-time collaboration)