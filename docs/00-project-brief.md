# Project Brief: ZooLink

**Derived from initiation brief answers (10 questions). This document serves as the anchor context for all SDD artifacts.**

## 1. Target Platform for MVP
Web-only with mobile responsiveness; separate native applications are planned for phase 2.

## 2. Domain Breakdown
- Identity Domain (authentication, user profiles)
- Animal Domain (animal entity as a separate aggregate root)
- Pet Marketplace Domain (listings for pets)
- Livestock Marketplace Domain (listings for livestock)
- Matching Domain (specific logic for matching pairs for breeding)
- Admin Domain (pre-moderation, directory management, user blocking)
*(Social/Community, Chat, Forum, Calendars, Articles deferred to future phases)*

## 3. Animal as Entity
Yes, the animal is a separate entity (aggregate root). One animal can have multiple listings (for sale, breeding, exhibition, participation in exhibitions, etc.).

## 4. Chat for MVP
No. Chat is moved to phase 2. In MVP, interaction occurs through displaying contacts after moderation of the listing (phone number, TG/VK links).

## 5. Geo-search
Mandatory. Requires search within a radius (1–100 km from the user), not only by cities/regions.

## 6. Moderation
Pre-moderation (listing appears only after moderator review). Requires an admin panel for queue and decision-making.

## 7. Separating Pets and Livestock
Yes, strict separation of storefronts: different attribute sets, different validation rules, separate UI flows (different sections of the site).

## 8. Authorization
Phone (SMS code) + OAuth via Google, Apple, Telegram, VK. Email verification is optional (does not block registration).

## 9. Stack (Preliminary)
- Backend: Node.js (NestJS) – chosen for modularity, DI, and DDD module support.
- Database: PostgreSQL – relational model suits complex relationships and transactions.
- External file storage: S3-compatible (MinIO in dev).
- Caching: Redis (sessions, directories).
- Integrations: SMS gateway, OAuth providers, geocoder (Yandex.Maps on free tier).

## 10. Most Complex/Risky Aspect in MVP
- **Security**: protection of animal data (especially livestock), fraud prevention, compliance with Federal Law 152-FZ.
- **Geo-search performance**: ensuring response time <1s for radius queries requires proper indexing and possibly PostGIS in the future.
- **Pre-moderation workflow**: the need for manual review as volume grows requires a product-operational balance (possibly later ML assistant).

## Additional Notes from Discussion
- Architecture should allow adding future features (chat, video, forums, breeding calendars, integration with Mercury, billing) without major rewriting. This is achieved through:
  - Strict bounded contexts (DDD modules) with clear API contracts.
  - Event-driven communication between domains (NestJS events or a decoupled message broker later).
  - Extensible database schema (using JSONB for experimental attributes, migrations only for core changes).
  - Feature toggles for risky boundaries (chat, monetization).
  - Storing files in folders, allowing addition of new content types (videos, documents, albums).