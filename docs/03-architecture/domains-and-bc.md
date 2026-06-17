# Bounded Contexts and Interactions

This document describes the bounded contexts of the ZooLink system according to the principles of Domain-Driven Design (DDD) and their interactions.

## Overview of the ZooLink System as a Set of Bounded Contexts

ZooLink consists of several bounded contexts, each of which has its own separate domain model, ubiquitous language, and clearly defined boundaries of responsibility. The contexts interact through well-defined interfaces (APIs, events).

## Bounded Contexts

### 1. Identity Context

**Purpose:** Management of users, authentication, authorization, and profiles.

**Core entities:**
- User
- Role
- Permission
- Session
- AuthProvider

**Ubiquitous Language:**
- authentication, authorization, login, registration, profile, role, permission, session, token
- identity provider (Google, Apple, Telegram, VK)
- phone/email verification, two-factor authentication

**Boundaries:**
- Does not contain information about animals or listings
- Responsible for all access and identity matters
- Provides authentication/authorization services to other contexts

### 2. Organization Context

**Purpose:** Management of organizations (kennels, shelters, farms, veterinary clinics) and their structure.

**Core entities:**
- Organization
- Branch
- OrganizationMember
- OrganizationRole

**Ubiquitous Language:**
- organization, branch, division, owner, employee, moderator, administrator
- organization hierarchy, headquarters, regional office

**Boundaries:**
- Does not directly contain information about animals or listings
- Connects to the Identity Context through users
- Connects to the Animal Context through ownership

### 3. Animal Context - System Core

**Purpose:** Management of information about animals as the central entity of the system.

**Core entities:**
- Animal - the aggregate root
- Species
- Breed
- Color
- HealthRecord
- ReproductionHistory

**Ubiquitous Language:**
- animal, species, breed, sex, age, nickname, coat color, chip
- medical history, vaccinations, sterilization/castration
- weight, height, behavioral traits, pedigree

**Boundaries:**
- Contains all information about an animal throughout its life
- Connects to the Listings Context (one animal -> many listings)
- May have several owners over time (ownership transfer)
- Does not contain information about prices or transaction terms

### 4. Pet Marketplace Context

**Purpose:** Management of listings for pets (dogs, cats, birds, reptiles, etc.).

**Core entities:**
- Listing - an entity within the animal aggregate
- Listing photos
- Moderation statuses
- Listing types (sale, adoption, lost & found)

**Ubiquitous Language:**
- pet, companion, adoption, lost-and-found
- sale, price, bargaining, delivery, meetup
- vaccinations, sterilized, not aggressive, good with children

**Boundaries:**
- Specific to pets (not for livestock)
- Uses the shared animal entity from the Animal Context
- Unique attributes: temperament, trainability, compatibility with other animals
- A moderation queue separate from the livestock context

### 5. Livestock Marketplace Context

**Purpose:** Management of listings for agricultural animals (cattle, horses, sheep, goats, pigs, poultry).

**Core entities:**
- Listing - an entity within the animal aggregate
- Listing photos
- Moderation statuses
- Listing types (sale, breeding, show, slaughter)

**Ubiquitous Language:**
- livestock, productivity, breeding value, genetics
- milk yield, weight gain, egg production, wool
- veterinary passport, genetic test, herd book
- transportation, loading/unloading, veterinary escort

**Boundaries:**
- Specific to agricultural animals
- Uses the shared animal entity from the Animal Context
- Unique attributes: productive qualities, genetic value, breeding pedigree
- Requires regulatory documentation (movement permits, veterinary certificates)

### 6. Matching Context

**Purpose:** Finding suitable pairs/groups of animals for various purposes (breeding, companionship, co-housing).

**Core entities:**
- BreedingPair
- CompatibilityRule
- MatchingAlgorithm
- MatchResult

**Ubiquitous Language:**
- compatibility, genetic diversity, inbreeding
- temperament, size, age difference
- coefficient of relationship, genetic distance
- preferred housing conditions, exercise regimen

**Boundaries:**
- Does not store final results as transactions
- Provides recommendations based on algorithms
- May use data from the Animal and Marketplace contexts
- Results may lead to the creation of listings in the marketplace contexts

### 7. Admin Context

**Purpose:** Management of reference data, moderation, and system administration.

**Core entities:**
- Reference data: species, breeds, cities, regions
- ModerationQueue
- ModerationAction
- AuditLog
- SystemSettings

**Ubiquitous Language:**
- moderation, approval, rejection, reason, comment
- reference table, classification, standardization
- activity log, change tracking, compliance
- settings, configuration, thresholds, limits

**Boundaries:**
- Provides reference data to other contexts
- Manages the listing moderation workflow
- Does not contain domain business logic (animals, listings, etc.)
- Ensures end-to-end tracking and compliance with requirements

### 8. Notifications Context

**Purpose:** Management of the creation, storage, and delivery of notifications to users.

**Core entities:**
- NotificationTemplate
- Notification
- DeliveryChannel
- NotificationPreferences

**Ubiquitous Language:**
- notification, alert, reminder, event, update
- email, SMS, push notification, in-app
- immediate, deferred, batched, disabled
- subscription, mark as read, archiving

**Boundaries:**
- Reacts to events from other contexts
- Does not contain domain business logic
- Supports multiple delivery channels
- Respects user preferences for types and channels

### 9. Payments Context - Phase 2+

**Purpose:** Processing payments for premium services, listing promotion, etc.

**Core entities:**
- Payment
- Subscription
- Invoice
- PaymentMethod

**Ubiquitous Language:**
- payment, refund, dispute, verification
- subscription, period, renewal
- automatic charge, attempt, failure
- escrow, deposit, security payment

**Boundaries:**
- Integrates with external payment gateways
- Does not store sensitive payment data (PCI DSS)
- Interacts with the marketplace context for paid services
- Planned for phase 2+

## Interactions Between Contexts

### Synchronous Interactions (request/response)

1. **Identity ↔ All contexts**
   - All contexts verify authentication and authorization through the Identity Context
   - Used for: token verification, retrieving user/role information

2. **Organization → Animals / Marketplaces**
   - When creating a listing, the ownership of the animal by the organization/user is verified
   - Used for: retrieving information about the animal's owner

3. **Marketplaces → Animals**
   - To validate a listing, it is necessary to verify the existence and ownership of the animal
   - Used for: retrieving basic information about the animal (species, breed, sex, etc.)

4. **Marketplaces → Administration**
   - During moderation, reference data is used (species, breeds, etc.)
   - When retrieving the list of listings for moderation, the moderation queue is used
   - Used for: reference tables for validation, moderation queue

5. **Matching → Animals**
   - To calculate compatibility, animal characteristics are required
   - Used for: retrieving animal attributes (species, breed, age, health, etc.)

6. **Notifications ← All contexts**
   - Other contexts send events to create notifications
   - Used for: publishing events about important actions (listing creation, status change, etc.)

### Asynchronous Interactions (events)

1. **Animals → Marketplaces**
   - Event: animal created/updated/deactivated
   - Handlers: updating related listings, validating listings

2. **Marketplaces → Notifications**
   - Event: listing created/moderated/published/rejected
   - Handlers: notifying the owner, potential buyers, moderators

3. **Marketplaces → Animals**
   - Event: listing published with a specific price/terms
   - Handlers: updating animal statistics (number of sales, average price, etc.)

4. **Administration → Marketplaces**
   - Event: reference data updated (new breed added, city list changed)
   - Handlers: updating the reference data cache, validating existing data

5. **Organizations → Notifications**
   - Event: user added/removed from an organization, role changed
   - Handlers: notification about access change, invitation to join

## Interaction Patterns

### API Composition
- Contexts provide RESTful APIs for interaction
- Each context is responsible for its own data model
- Requests between contexts go through well-defined endpoints

### Event-driven Architecture
- Significant domain changes are published as events
- Other contexts subscribe to the relevant events
- A lightweight event broker is used (Redis Pub/Sub in the MVP, with a planned migration to Apache Kafka/RabbitMQ)

### Shared Kernel
- A small part of the code shared by several contexts
- In ZooLink: shared infrastructure (logging, exception handling, basic DDD structures)
- Minimal in size and carefully controlled

### Conformist
- One context follows the model of another context
- Example: the marketplace contexts conform to the animal model from the Animal Context
- They do not duplicate data, but reference it

### Anti-Corruption Layer (ACL)
- Protects a context from unwanted external influences
- Used when interacting with external systems (payment gateways, regulatory systems)
- Translates external models into the internal domain model

## Cross-Context Dependencies

| Consumer Context | Depends on Context | Dependency Type | Description |
|----------------------|----------------------|-----------------|----------|
| Marketplaces (pet)   | Animals              | Command         | Requires the existence and ownership of an animal for a listing |
| Marketplaces (livestock) | Animals          | Command         | Requires the existence and ownership of an animal for a listing |
| Marketplaces (pet/livestock) | Administration | Command       | Requires reference data for validation and moderation |
| Marketplaces         | Identity             | Command         | Requires authentication/authorization for actions |
| Matching             | Animals              | Command         | Requires animal characteristics to calculate compatibility |
| Notifications        | All domain contexts  | Broad           | Generate notifications based on domain events |
| Organization         | Identity             | Command         | Organization users must exist in the Identity Context |
| Administration       | None                 | Self-contained  | Provides services to other contexts |
| Animals              | None                 | Self-contained  | System core, does not depend on the business logic of other contexts |

## Political Boundaries

### Context Owners
- Identity Context: Backend team (authn/authz)
- Organization Context: Backend team (organizational structure)
- Animal Context: Backend team (system core, the most stable)
- Pet Marketplace Context: Backend team + pet moderation team
- Livestock Marketplace Context: Backend team + livestock moderation team
- Matching Context: Backend team (algorithms and rules)
- Admin Context: Administration team + moderation team
- Notifications Context: Backend team (delivery infrastructure)
- Payments Context: Backend team (financial operations)

### Single Source of Truth
- **Animals:** Animal Context (the only source of information about an animal)
- **Users:** Identity Context (the only source of authn/info)
- **Organizations:** Organization Context (the only source of org structure)
- **Reference data:** Admin Context (species, breeds, cities, etc.)
- **Listings:** Split across the marketplace contexts, but reference animals
- **Matches:** Matching Context (algorithm results, not stored permanently)

## Evolution Paths

### From One Context into Several
- As a context grows in complexity, it can be split
- Example: if the notification functionality grows significantly, it can be split into:
  - In-app notifications
  - Email notifications
  - SMS/Push notifications
  - External integrations (Slack, Webhook, etc.)

### Merging Contexts
- Unlikely in ZooLink due to the clearly domain-oriented structure
- Possible future merge: if requirements change significantly

### Technological Evolution Within a Context
- Each context can evolve independently in its choice of technologies
- Example: the notifications context may start using a separate service for processing large volumes
- Compatibility is maintained through contracts (API/events)

## Related Decisions

- [ADR-0001: Technology stack selection](../04-decisions/0001-tech-stack.md)
- [ADR-0002: Hard split of markets](../04-decisions/0002-hard-split-markets.md)
- [ADR-0003: Pre-moderation workflow](../04-decisions/0003-pre-moderation-workflow.md)
- [ADR-0004: Animal as the aggregate root](../04-decisions/0004-animal-as-aggregate.md)
- [ADR-0005: No built-in chat in the MVP](../04-decisions/0005-no-chat-mvp.md)

## Context Diagrams

See additional documents for visual representations:
- C4 level 3 (components within contexts) - planned
- Structural diagram of domain models - see the diagrams in the domain specifications
- Diagram of contexts and their interactions (planned as a separate artifact)
