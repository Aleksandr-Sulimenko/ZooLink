---
version: "2.0"
lastUpdated: "2026-06-17"
author: "System Analyst"
status: "Approved"
---

# Glossary of ZooLink Terms

> Conventions: code/contract identifiers (table/column names, ENUM values, role constants) are kept verbatim in both EN and RU; only prose is translated. Source of truth for data is `database_schema.sql`; for decisions, the ADRs in `04-decisions/`.

## Domains & Architecture

**ZooLink**  
Marketplace/platform for animals. Two strictly separated markets (ADR-0002): the **Pet Marketplace** (companion animals) and the **Livestock Marketplace** (farm/breeding animals).

**Bounded Context**  
A domain boundary with its own model and ubiquitous language (DDD). ZooLink's contexts include Identity, Animal, Organization, Pet/Livestock Marketplace, Matching, Moderation, Payment, Notification, Geo-Search, Admin.

**Aggregate Root**  
The entry-point entity that guards the consistency of an aggregate. The **Animal** is the aggregate root of the Animal Domain (ADR-0004); listings are entities referencing it.

**Identity Domain**  
Context responsible for users, authentication (phone/SMS, OAuth), roles, and account lifecycle.

**Animal Domain**  
Context owning the `animals` aggregate, ownership history, and ownership transfers.

**Pet Marketplace / Livestock Marketplace**  
The two listing markets, hard-split per ADR-0002 (pet = companion animals; livestock = farm/breeding animals).

**Organization Domain**  
Context for legal entities (clinics, kennels, shelters, farms), their branches, and staff affiliations (M:N).

**Moderation Domain**  
Context implementing the pre-moderation workflow (ADR-0003): queue, decisions (append-only), reason codes, and user content reports.

**Payment Domain**  
Context for payment transactions and refunds. Gated behind `feature_toggles.payments` (off until post-MVP).

**Notification Domain**  
Context for transactional/promotional notifications: templates, delivery logs, and user preferences.

**Matching Domain**  
Context that suggests breeding pairs/partners based on animal attributes.

**Geo-Search Service**  
Cross-domain capability to find listings within a radius (1–100 km) of a point (see **Geo-search**).

**Admin Domain**  
Context for reference-data management, system settings, and operational tooling.

## Entities (core tables)

**User**  
A principal interacting with ZooLink (buyer, seller, moderator, admin, or AI agent). Stored in `users`; authenticated via the Identity Domain. See **Principal**, **Role**.

**Animal**  
The aggregate root; an animal owned by exactly one party (a user **or** an organization — XOR, `chk_animal_ownership`). Stored in `animals`.

**Listing** (a.k.a. **Advertisement**)  
A record in a marketplace describing an animal for sale/breeding/show/adoption/stud-service. Stored in `listings`. "Advertisement" is the prose synonym; the canonical table/entity is **listing**.

**Organization / Branch / Organization User**  
A legal entity (`organizations`), its physical location (`branches`), and the M:N affiliation of users to organizations with a `role_in_org` (`organization_users`).

**Conversation / Message**  
Buyer↔seller dialogue per listing (`conversations`, `messages`). In-app chat is deferred (ADR-0005); tables exist for future use.

**Favorite**  
A user's saved listing (`favorites`, UNIQUE per user+listing). MVP feature.

**Saved Search**  
A user's saved filter set + location/radius (`saved_searches`, UC-GS-03). Proactive alerts on saved searches are Phase 2.

**Content Report**  
A user-submitted flag on content (`content_reports`: reporter, entity, reason, status OPEN/REVIEWED/DISMISSED/ACTIONED). Feeds the moderation queue.

**Ownership Transfer**  
The process entity (`ownership_transfers`) governing the transfer of an animal between parties (state machine). Distinct from `animal_ownership_history` (the settled log). Ownership change is locked during MVP.

**Moderation Decision**  
An append-only audit record (`moderation_decisions`) of a moderator/agent's decision (APPROVED/REJECTED/CHANGES_REQUESTED). Immutable (UPDATE/DELETE blocked by trigger).

**Moderation Reason**  
A configurable reason code (`moderation_reasons`) selectable when deciding/reporting.

**Payment Transaction / Refund**  
A payment (`payment_transactions`) and its refund (`refunds`). Amounts are **minor units** (BIGINT), never floats.

**Notification Template / Notification Log**  
A per-language message template (`notification_templates`) and the delivery record (`notification_logs`).

**Species / Breed / City**  
Reference (lookup) data with INTEGER keys (`species`, `breeds`, `cities`). See **ID convention**.

**Feature Toggle**  
A flag (`feature_toggles`) gating phased/paid/experimental capabilities (e.g., `payments`).

**Outbox Event**  
A row in `outbox_events` implementing the **Outbox pattern** for reliable event publishing to external systems.

## Roles & Principals

**Principal**  
Any actor that can authenticate and act. Typed by `users.principal_type` as **HUMAN** or **AGENT** (ADR-0006).

**AI Agent**  
A specially-trained automated principal (`principal_type=AGENT`) that may hold operator roles (Moderator now, Admin later) toward AI-operated platform operations (ADR-0006). Inactive until feature-flagged; human accountability and override are mandatory.

**Role** (platform)  
`users.role` ∈ {USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER}. Roles are additive.

**Role in Org**  
`organization_users.role_in_org` ∈ {OWNER, ADMIN, STAFF, VET, MODERATOR} — permissions within an organization.

**VET ≡ VETERINARIAN**  
The professional "veterinarian" appears as two tokens in two **different** role systems: the organizational role is `VET` (`role_in_org`), the platform role is `VETERINARIAN` (`users.role`). They denote the same profession in different scopes (org vs platform).

**Moderator / Admin**  
Operator roles that review content / administer the platform. May be held by a HUMAN or an AGENT (ADR-0006).

## Statuses & State Machines

**State Machine**  
A formal model of an entity's lifecycle (states + guarded transitions). ZooLink state machines: listing, user, ownership transfer, payment, notification (`specs/statemachines/`).

**Listing status**  
`listings.status` ∈ {DRAFT, PENDING_MODERATION, ACTIVE, EXPIRED, SOLD, DEACTIVATED}. Only **ACTIVE** listings appear in public search. (Earlier docs used "PUBLISHED" → now `ACTIVE`.)

**Moderation status**  
`listings.moderation_status` ∈ {PENDING, APPROVED, REJECTED, CHANGES_REQUESTED} — the review outcome, a field **separate** from the lifecycle `status`.

**User status**  
`users.status` ∈ {UNVERIFIED, PENDING_VERIFICATION, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED}.

**Payment status**  
`payment_transactions.status` ∈ {PENDING, COMPLETED, FAILED, REFUNDED, DISPUTED}. (A listing sells when payment is **COMPLETED**.)

**Notification status**  
`notification_logs.status` ∈ {SENT, DELIVERED, FAILED, BOUNCED}.

**Ownership transfer status**  
`ownership_transfers.status` ∈ {PENDING, IN_PROGRESS, COMPLETED, FAILED}.

**Pre-moderation**  
The workflow (ADR-0003) where a listing is not publicly visible until a moderator/agent approves it (`PENDING_MODERATION` → `ACTIVE`).

## Data & Architecture Concepts

**ID convention**  
Business entities use **UUID** primary keys; lookup/reference tables (`species`, `breeds`, `cities`, `supported_languages`) use **INTEGER** keys. Hence `species_id`/`breed_id`/`city_id` are INTEGER.

**Passwordless auth**  
End-user authentication uses **phone OTP + OAuth**, never a password. `password_hash` is reserved for operator roles (ADMIN/MODERATOR) only (spec 01 round-4).

**OTP (one-time password)**  
6-digit SMS verification code: TTL 5 min, 60 s resend cooldown, 5 attempts then 15-min lockout. Stored only as a SHA-256 digest in Redis (never at rest in PG); keyed by `phone_hash`.

**phone_hash (HMAC + pepper)**  
Deterministic `HMAC-SHA256(phone, server_pepper)` (base64url) of the E.164 phone, stored unique on `users`. Deterministic (unlike bcrypt) so phones are unique/look-up-able without storing the raw number; the `PHONE_HASH_PEPPER` secret is server-side env.

**creator_id ≡ seller_id**  
`creator_id` is the business term for "the user who posted a listing (for audit)"; it maps to the canonical schema column `listings.seller_id`. Same field; for org listings it is the affiliated user who created the listing.

**Localized (JSONB)**  
`*_localized` columns store translations as a JSONB object keyed by language code, e.g. `{"en":"Name","ru":"Название"}`. Helper DB functions: `get_localized`, `has_translation`. Supported languages live in `supported_languages`.

**Minor units**  
Monetary amounts stored as integers in the currency's smallest unit (e.g., kopecks), as BIGINT — never floating point. Fields: `listings.price_cents`, `payment_transactions.amount_minor`, `refunds.amount_minor`.

**Idempotency key**  
A unique key attached to payment create/confirm/webhook calls so retries/replays do not double-charge or double-transition (`payment_transactions.idempotency_key`).

**Append-only audit**  
A table where rows can only be inserted, never updated/deleted (enforced by trigger). Used for `moderation_decisions` to keep a tamper-evident trail.

**Outbox pattern**  
Reliability pattern: domain events are written to `outbox_events` in the same transaction as the state change, then published asynchronously to external systems.

**Haversine / Bounding box**  
Geo-search math: the Haversine formula computes great-circle distance between two lat/lng points; a bounding-box pre-filter narrows candidates before the precise distance check (MVP-primary geo path; PostGIS optional).

**RAG / RLM**  
Retrieval-Augmented Generation / a retrieval layer over the documentation. May be used by AI agents for policy-grounded knowledge (see `RLM_RAG_HANDOFF.md`).

## Concrete JSONB Schemas

**Health Records**  
A JSONB array column in `animals` storing veterinary health events. Each object: `type` (string), `detail` (string), `date` (ISO 8601), `provider` (string).  
Example: `[{"type":"vaccination","detail":"Rabies","date":"2024-05-10","provider":"Green Vet Clinic"}]`

**Reproductive Data**  
A JSONB array column in `animals` for reproductive events (mainly females). Each object: `event` (heat_start/mating/pregnancy_confirmation/birth), `date` (ISO 8601), `partner_id` (UUID, nullable).  
Example: `[{"event":"heat_start","date":"2024-06-01","partner_id":"550e8400-e29b-41d4-a716-446655440000"}]`

**Metadata**  
A JSONB extensibility column on `organizations`, `branches`, `listings`. Stores custom key-value attributes; default `'{}'::jsonb`.  
Example: `{"subscription_tier":"premium","branding":{"primary_color":"#FF5733"}}`

## External & Legal

**152-ФЗ**  
Russian Federal Law "On Personal Data" No. 152-ФЗ (2006-07-27), governing personal-data processing. A responsible human/legal entity remains accountable even when AI agents operate the platform.

**INN / KPP**  
Russian tax identifiers for legal entities: INN (taxpayer ID) and KPP (tax registration reason code); stored on `organizations`.

**SMS provider**  
External service for sending SMS (e.g., verification codes).

**Yandex.Maps API**  
Yandex cartography/geocoding service used for maps and address→coordinates geocoding.

**Payment gateway**  
External PCI-compliant service that processes payments; ZooLink stores only metadata, never raw card data (spec 14).

**Cloud / Object storage**  
S3-compatible storage for media files (listing photos, etc.).
