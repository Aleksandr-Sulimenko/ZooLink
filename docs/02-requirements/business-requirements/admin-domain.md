# Admin Domain: ZooLink

## Purpose
Manages system configuration, reference data, moderation workflows, and user roles. This domain ensures data consistency, supports content quality control, and provides operational tools for platform maintenance.

## Core Concepts
- **Reference Data**: Standardized lists used across domains (species, breeds, cities, traits, health certifications, etc.)
- **Moderation Queue**: Listings awaiting review, with tools for approving/rejecting and providing feedback
- **User Roles & Permissions**: Defines what users can do in the system (USER, MODERATOR, ADMIN)
- **System Settings**: Configuration flags and parameters that affect platform behavior
- **Audit Trail**: Logs of moderation actions, role changes, and system events for accountability

## Business Rules
### 1. Reference Data Management
- Reference data is curated and maintained by admins/moderators (not user-editable on MVP).
- Common reference datasets include:
  - **Species**: Taxonomic classifications (Canis lupus familiaris, Felis catus, Bos taurus, etc.)
  - **Breeds**: Within-species varieties (Labrador Retriever, Holstein Friesian, Siamese, etc.)
  - **Cities/Regions**: Geographic hierarchy for geo-search (Country → Region → City → District)
  - **Traits & Descriptors**: Standardized temperament, health, and production descriptors
  - **Health Certifications**: Recognized test/vaccination types (TB-free, Brucellosis-negative, etc.)
  - **Genetic Markers**: Known DNA test results (coat color, polled/horned, disease resistance)
  - **Listing Types**: SALE, MATING, ADOPTION, STUD_SERVICE, LEASING (extensible)
  - **Animal Statuses**: ACTIVE, ARCHIVED, DECEASED (for future)
- Reference data can be:
  - **Activated/Deactivated**: Without deletion (for historical data integrity)
  - **Versioned**: Changes tracked via audit log (who changed what and when)
  - **Localized**: Support for multiple languages in Фаза 2+ (RU primary on MVP)
- Validation: Reference data entries must have unique codes/names within their dataset.

### 2. Moderation Workflow
- **Queue Types**: Separate queues for PET and LIVESTOCK listings (can be combined view)
- **Queue Ordering**: 
  - Default: FIFO (first in, first out)
  - Priority options: 
    - Newest first
    - By species (to batch similar reviews)
    - By reporter/user reputation (future)
- **Moderator Actions per Listing**:
  - **APPROVE**: 
    - Changes listing status to PUBLISHED
    - Requires no additional input (though comment optional)
    - Listing becomes immediately visible in search
  - **REJECT**:
    - Returns listing to DRAFT state
    - **Requires mandatory rejection reason** (selected from predefined list + optional custom text)
    - User notified with reason and can edit/resubmit
  - **FLAG FOR REVIEW**: 
    - Special status for complex cases requiring senior moderator input
    - Does not change listing state but adds indicator
  - **BAN USER** (from moderation view):
    - Available if moderator detects pattern of abuse/spam
    - Requires specifying reason and duration (temporary/permanent)
- **Rejection Reasons** (configurable by admin):
  - Spam / Low-effort content
  - Inappropriate photos (not matching animal, offensive)
  - Misleading information (false breed claims, unrealistic prices)
  - Policy violation (promoting illegal activities)
  - Incomplete information (missing key details)
  - Duplicate listing
  - Welfare concern (underage animals, obvious neglect)
  - Other (with explanation)
- **Moderation Time Limits**:
  - Target: <4 hours for pet listings, <6 hours for livestock listings during business hours (9AM-9PM)
  - Escalation: If queue >50 items, notify senior moderators
  - Aging: Listings >24h in queue highlighted in moderator view

### 3. User Roles & Permissions
- **USER** (default role after registration):
  - Can create/edit own profile and animals
  - Can create/listings (goes to moderation)
  - Can search and view public listings
  - Can show contacts on PUBLISHED listings
  - Can deactivate/reactivate own animals/listings
  - Cannot moderate content or manage reference data
- **MODERATOR**:
  - All USER permissions
  - Can moderate listings (approve/reject with required comments for reject)
  - Can view moderation queue and analytics
  - Can manage reference data (activate/deactivate, suggest edits)
  - Can ban users temporarily (up to 30 days) with reason
  - Can view basic user analytics (registration dates, listing counts)
  - Cannot change user roles to/from MODERATOR/ADMIN
  - Cannot access system settings
- **ADMIN**:
  - All MODERATOR permissions
  - Can manage user roles (promote to MODERATOR, demote from MODERATOR/ADMIN)
  - Can ban users permanently or for extended periods
  - Can manage system settings and feature toggles
  - Can view full system analytics and logs
  - Can manage API keys and third-party integrations
  - Can initiate data exports/GDPR requests
  - Cannot modify core platform code (requires deployment)
- **SUPER ADMIN** (system role, not assigned via UI):
  - Full system access (for emergency/maintenance)
  - Typically held by platform owners/devops

### 4. Role Assignment & Management
- New users register as USER by default.
- Role promotion:
  - USER → MODERATOR: Requires ADMIN approval + basic training
  - MODERATOR → ADMIN: Requires ADMIN approval + trust assessment
  - Reverse demotion possible at any time
- Moderator onboarding includes:
  - Review of platform policies and guidelines
  - Training on spotting common violations
  - Shadowing period with experienced moderator
- Admins can see moderation statistics (reviews/hour, accuracy via appeal rate)
- Role changes are logged in audit trail with reason.

### 5. System Settings & Feature Toggles
- Settings controllable by ADMIN role:
  - **Feature Flags**: Enable/disable upcoming functionality (chat, video, forums)
  - **Rate Limits**: Adjust thresholds for actions (listing creation, contact shows, etc.)
  - **Moderation Parameters**: Queue thresholds, auto-expiration times
  - **Search Defaults**: Default radius, sort order, items per page
  - **Integration Settings**: API keys for SMS, OAuth providers, maps, email
  - **Maintenance Mode**: Read-only mode for updates/backups
  - **Limits & Thresholds**: Max photos per listing, max description length, etc.
- Settings stored in database with change audit.
- Some settings require restart/redeploy to take effect (documented).
- **Feature Toggles specifically**:
  - `CHAT_ENABLED`: Controls real-time messaging (off on MVP)
  - `VIDEO_ENABLED`: Controls video uploads/playback (off on MVP)
  - `FORUM_ENABLED`: Controls discussion boards (off on MVP)
  - `CALENDAR_ENABLED`: Controls reproductive calendars (off on MVP)
  - `AI_MODERATION`: Controls ML-assisted pre-screening (off on MVP)
  - `NEGOTIABLE_PRICE`: Controls if "negotiable" allowed in price field (on for MVP)
  - `CUSTOM_BREED_TEXT`: Controls if users can enter custom breed text (on for MVP)

### 6. Audit Trail & Compliance
- Critical actions logged for accountability and debugging:
  - Moderation actions (who approved/rejected what listing and why)
  - Reference data changes (who added/removed/modified what)
  - Role changes (who promoted/demoted whom and why)
  - User bans (who banned whom, reason, duration)
  - Settings changes (what changed, from/to, who)
  - Data exports/GDPR requests
- Audit logs include:
  - Timestamp (UTC)
  - Actor user ID and role at time of action
  - Action type and target entity ID
  - Before/after values (for changes)
  - Reason/comment (if applicable)
  - IP address and user agent (for security monitoring)
- Logs retained per data retention policy (minimum 1 year for moderation/logs).
- Access to audit logs restricted to ADMIN role.
- Does NOT log sensitive personal data (passwords, tokens, full PII).

## Non-Functional Requirements (Specific to Admin)
- **Performance**:
  - Moderation queue load: <2s for 100 items
  - Reference data lookup: <100ms for any dataset
  - Action logging: <50ms overhead per audited action
- **Scalability**:
  - Support 100+ active moderators
  - Handle 1000+ moderation actions per day during peak
  - Reference datasets up to 10k entries each (species, breeds, etc.)
- **Consistency**:
  - Reference data changes visible globally within 1s (cache invalidation)
  - Moderation actions atomic (either fully applied or not)
  - Role changes take effect immediately for new sessions
- **Extensibility**:
  - New reference datasets can be added via admin interface
  - New moderation actions/reasons can be configured
  - New feature toggles follow standard pattern
- **Security**:
  - Strong password requirements for MODERATOR/ADMIN roles (min 12 chars)
  - MFA encouraged for ADMIN role (planned for Фаза 2+)
  - Session timeout: 15 minutes of inactivity for sensitive actions
  - Audit logging itself is tamper-evident (append-only, signed entries)
  - Principle of least privilege: MODERATOR cannot promote users to ADMIN

## Data Model (Conceptual)
### Reference Data Entity (Generic Pattern)
| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | UUID | Yes | Primary key |
| `dataset` | VARCHAR(50) | Yes | Name of reference dataset (species, breeds, cities, etc.) |
| `code` | VARCHAR(50) | Yes | Unique code within dataset (e.g., "LAB", "HOL") |
| `name_localized` | JSONB | Yes | Multilingual names (RU primary on MVP: {"ru": "Лabrador Retriever"}) |
| `description` | TEXT | No | Extended description |
| `is_active` | BOOLEAN | Yes | Whether available for selection |
| `sort_order` | INT | No | For custom ordering in lists |
| `metadata` | JSONB | No | Dataset-specific attributes (e.g., for species: taxonomic class) |
| `created_at` | TIMESTAMP | Yes |  |
| `updated_at` | TIMESTAMP | Yes |  |
| `created_by` | UUID (FK to Users.id) | Yes | Who created the entry |
| `updated_by` | UUID (FK to Users.id) | Yes | Who last updated it |

### Moderation Log Entity
| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | UUID | Yes | Primary key |
| `listing_id` | UUID (FK to Listings.id) | Yes | The listing being moderated |
| `moderator_id` | UUID (FK to Users.id) | Yes | Who performed the action |
| `action` | ENUM('APPROVE', 'REJECT', 'FLAG') | Yes | What was done |
| `reason_code` | VARCHAR(50) | No | Standardized rejection reason (if REJECT) |
| `reason_text` | TEXT | No | Custom explanation (required for REJECT) |
| `created_at` | TIMESTAMP | Yes | When action occurred |
| `metadata` | JSONB | No | Additional context (e.g., IP, user agent) |

### User Role Assignment (Simplified View)
| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | UUID (FK to Users.id) | Yes | The user |
| `role` | ENUM('USER', 'MODERATOR', 'ADMIN') | Yes | Assigned role |
| `assigned_at` | TIMESTAMP | Yes | When role was granted |
| `assigned_by` | UUID (FK to Users.id) | Yes | Who made the change (ADMIN) |
| `expires_at` | TIMESTAMP | No | For temporary roles (not used on MVP) |
| `reason` | TEXT | No | Why role was granted/changed |

## User Journey: Moderating a Listing
```mermaid
sequenceDiagram
    participant Moderator
    participant Frontend
    participant Backend (NestJS Admin/Moderation Module)
    participant Database
    participant Listing (in Pet/Livestock Domain)

    %% Moderator logs in and views queue
    Moderator->>Frontend: Opens moderation page
    Frontend->>Backend: GET /moderation/queue?type=pet&limit=20&offset=0
    Backend->>Database: Returns pending listings with basic info
    Backend->>Frontend: Returns queue items (title, species, age, time waiting)

    Moderator->>Frontend: Selects listing #3 to review
    Frontend->>Backend: GET /moderation/listing/{id} (gets full details)
    Backend->>Database: Fetches listing + linked animal + photos
    Backend->>Frontend: Returns full listing data for review

    Moderator->>Frontend: Reviews listing, decides to approve
    Frontend->>Backend: POST /moderation/action {listing_id: X, action: APPROVE}
    Backend->>Database: 
      1. Updates listing.status to PUBLISHED
      2. Inserts moderation_log entry (APPROVE, moderator_id, timestamp)
    Backend->>Frontend: Returns success

    %% Alternative: Reject with reason
    Moderator->>Frontend: Reviews listing, decides to reject (spam)
    Frontend->>Backend: POST /moderation/action {listing_id: Y, action: REJECT, reason_code: SPAM, reason_text: "Stock photo used, not matching described animal"}
    Backend->>Database: 
      1. Updates listing.status to DRAFT
      2. Sets moderation_log with REJECT reason
      3. Notifies user via email/in-app (decoupled service)
    Backend->>Frontend: Returns success

    %% Moderator manages reference data
    Moderator->>Frontend: Navigates to Reference Data -> Breeds -> Add New
    Frontend->>Backend: GET /reference-data/breeds/new (gets species list for dropdown)
    Backend->>Reference Data Service: Returns active species
    Backend->>Frontend: Returns species list

    Moderator->>Frontend: Selects species=Dog, enters code="LABZ", name="Лabrador Retriever (Золотистый)", description="..."
    Frontend->>Backend: POST /reference-data/breeds {species_id: X, code: "LABZ", name: {...}, description: "..."}
    Backend->>Database: 
      1. Validates code unique within breeds dataset
      2. Inserts new reference entry
      3. Logs action in audit trail (reference_data_create)
    Backend->>Frontend: Returns success

    %% Moderator bans user for abuse
    Moderator->>Frontend: Views user profile from listing, sees spam pattern
    Frontend->>Backend: POST /moderation/ban-user {user_id: Z, duration_days: 7, reason: "Repeated spam listings"}
    Backend->>Database:
      1. Sets user.banned_until = now + 7 days
      2. Sets user.ban_reason = "Repeated spam listings"
      3. Inserts audit log entry (user_ban)
      4. Optionally: hides user's current listings from search
    Backend->>Frontend: Returns success
```

## Open Questions & Assumptions
- **Assumption**: Initial reference data will be seeded from open sources (AKC, FCI, FAO breed lists) and refined over time.
- **Assumption**: Moderator workload on MVP will be manageable by 1-2 part-time moderators (<50 listings/day total).
- **Open Question**: Should we implement reputation/trust scoring for users to prioritize moderation queue? (Decided: No for MVP; rely on chronological queue + manual flagging.)
- **Assumption**: Moderators will receive basic policy training but not formal certification on MVP.
- **Assumption**: System will not use automated content filtering (AI/ML) for moderation on MVP to avoid false positives/negatives.
- **Assumption**: Appeal process for rejected listings: user can resubmit after edits; formal appeal process reserved for Фаза 2+.
- **Assumption**: Geographic reference data (cities) will be simplified hierarchy; detailed street-level addresses never stored/shown.

## Related Domains
- **Identity Domain**: Provides user base; roles extend user permissions; authentication required for admin access.
- **Animal Domain**: Manages species and breed directories; Admin Domain provides the curation interface.
- **Pet Marketplace & Livestock Marketplace**: Relies on Admin Domain for reference data (species, breeds, cities) and moderation workflow.
- **Matching Domain**: May use reference data for breeding goals, trait libraries, or species-specific compatibility factors.
- **Future Domains**: 
  - **Regulatory Compliance**: Will extend Admin Domain for managing regulatory reference data (e.g., certified labs, approved medications).
  - **Content Management**: For managing static pages, FAQs, and help center content.

## API Contract References (see 03-architecture/api-contracts/admin-api.yaml)
- `GET /reference-data/{dataset}` (get all active entries in dataset)
- `GET /reference-data/{dataset}/new` (get form for creating new entry)
- `POST /reference-data/{dataset}` (create new reference entry)
- `PATCH /reference-data/{dataset}/{id}` (update reference entry)
- `PATCH /reference-data/{dataset}/{id}/toggle-active` (activate/deactivate)
- `GET /reference-data/{dataset}/{id}` (get specific entry)
- `GET /moderation/queue` (get pending listings with filters: type, species, limit, offset)
- `GET /moderation/listing/{id}` (get listing details for moderation)
- `POST /moderation/action` (approve/reject/flag listing)
- `GET /moderation/log/{listing_id}` (get moderation history for listing)
- `POST /moderation/ban-user` (ban user with reason/duration)
- `GET /system/settings` (get current settings - ADMIN only)
- `PATCH /system/settings/{key}` (update setting - ADMIN only)
- `GET /audit/log` (get audit trail entries with filters - ADMIN only)
- `GET /users/roles` (get users with their roles - ADMIN only)
- `PATCH /users/{id}/role` (change user role - ADMIN only)