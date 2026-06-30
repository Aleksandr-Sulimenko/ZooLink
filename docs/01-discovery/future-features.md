# Future Features: ZooLink

## Purpose
Documents features and enhancements planned for post-MVP phases (Facза 2+). This helps keep the MVP scope focused while preserving ideas for future development.

## Facза 2: Growth (6-12 months)
### Core Features
- **Real-time Chat**: Text, voice, and video chat between users (after showing contacts or within listings)
- **Multilingual Support**: Interface and content available in multiple languages (starting with English)
- **Video Content**: 
  - Video uploads for listings (show animals in motion)
  - Live streaming for events (auctions, shows)
  - Video profiles for breeders/farms
- **Advanced Search**:
  - Saved searches with alerts
  - Image-based search (find similar animals)
  - Genetic trait search
- **Reproductive Tools**:
  - Heat cycle tracking and prediction
  - Mating calendar with reminders
  - Pregnancy tracker and due date calculator
- **Health & Genetics**:
  - Digital health passport (vaccination records, test results)
  - Genetics portal (DNA test results, pedigree analysis)
  - Health alert system (outbreaks, vaccination reminders)
- **Social Features**:
  - User following/followers
  - Activity feed (what users you follow are doing)
  - Groups and communities (by breed, interest, location)
  - Forum for discussions and Q&A
- **Content & Education**:
  - Article publishing platform (tips, guides, news)
  - Breed encyclopedia
  - Webinars and online courses
- **Monetization (Soft Launch)**:
  - Boost listings (pay to appear higher in search)
  - Premium profiles (verified badges, enhanced galleries)
  - Lead generation for veterinarians and services
  - Affiliate marketing for pet/livestock supplies

### Technical Enhancements
- **Performance**:
  - Read replicas for database
  - Advanced caching (Redis cluster, CDN for images)
  - Image optimization service (on-the-fly resizing, compression)
- **Scalability**:
  - Microservices for high-traffic components (matching, notifications)
  - Message queue (RabbitMQ/Amazon SQS) for asynchronous processing
  - Kubernetes orchestration
- **Search**:
  - Elasticsearch or similar for advanced text and geo-search
  - Faceted search and autocomplete improvements
- **Security**:
  - Web Application Firewall (WAF)
  - Regular penetration testing
  - Enhanced monitoring and alerting
  - MFA for all users (optional)
- **Data & Analytics**:
  - Data warehouse for business intelligence
  - Market intelligence reports (aggregated, anonymized)
  - A/B testing framework
  - User behavior analytics

### Regulatory & Compliance
- **Regulatory Integration**:
  - Vorbereitung for Меркурий/ВетИС integration (livestock movement tracking)
  - Automated document generation (sales contracts, health certificates)
- **Accessibility**:
  - Enhanced screen reader support
  - Sign language consideration for video content
  - Customizable UI (contrast, font sizes)
- **Legal**:
  - Terms of Service and Privacy Policy updates for new features
  - Consent management system

## Facза 3: Maturity (12+ months)
### Core Features
- **Full Transaction Support**:
  - Escrow service for high-value transactions
  - Integrated payments (secure checkout)
  - Shipping and logistics coordination
- **Advanced Breeding Tools**:
  - Pedigree builder and generator
  - Inbreeding coefficient calculator
  - Estimated breeding values (EBV) integration
  - Embryo and oocyte trading
- **AI & Machine Learning**:
  - Automated listing moderation assistance
  - Price suggestion engine (based on historical data)
  - Match recommendation improvement (ML-based)
  - Image moderation (detecting inappropriate content)
  - Breed recognition from photos
- **IoT & Smart Farming**:
  - Integration with farm management software
  - Sensor data display (temperature, activity, etc.)
  - Automated heat detection alerts
- **Marketplace Expansion**:
  - Full e-commerce for supplies (feed, equipment, medicine)
  - Service marketplace (vet, transport, training)
  - Auction platform (timed and live)
- **Globalization**:
  - Support for multiple currencies
  - International shipping considerations
  - Multi-country regulatory compliance
- **Community & Events**:
  - Event calendar (shows, sales, seminars)
  - Ticket sales for events
  - Member directories and networking

### Technical Enhancements
- **Architecture**:
  - Service mesh for microservices communication
  - Event streaming platform (Kafka) for real-time data flows
  - Advanced caching strategies (multi-level, predictive)
- **Data Science**:
  - Predictive analytics (disease outbreaks, market trends)
  - Personalized recommendations
  - Natural language processing for search and content
- **Security**:
  - Zero trust architecture
  - Advanced threat detection and response
  - Regular third-party security audits
- **DevOps**:
  - Advanced CI/CD with blue/green deployments
  - Canary releases and feature flags at scale
  - Comprehensive observability (logs, metrics, traces)

## Out of Scope for Facза 2&3 (Ideas for Far Future)
- Virtual reality animal viewing
- Genetic editing consultations (ethical considerations)
- Metaverse integration for virtual shows
- Autonomous vehicles for livestock transport
- Blockchain for pedigree and health records (if mature technology)

## AI-Operated Platform (long-term vision — see ADR-0006)

A strategic direction (ADR-0006): operator roles — first **Moderator**, in perspective **Admin** — can be performed by specially-trained **AI agents**, building toward a mechanism that **runs and maintains the platform as a business largely via AI agents**, with humans in governance/accountability roles.

- **Phase 2 entry point**: AI-assisted moderation (human-in-the-loop) — an agent proposes APPROVE/REJECT/CHANGES_REQUESTED with a confidence score; a human confirms. (Aligns with the "automated moderation (Phase 2)" item in the Moderation domain.)
- **Progressive autonomy**: assisted → supervised (autonomous above a confidence threshold, low-confidence escalates to humans) → operational agents for admin/reference-data/ops → AI-run business operations.
- **Baked into the data model now**: `users.principal_type` (`HUMAN`/`AGENT`) lets operator roles be held by an agent; all agent actions are recorded in the immutable `moderation_decisions` audit; agents are inactive until feature-flagged.
- **Non-negotiables**: a responsible human/legal entity stays accountable (152-ФЗ, prohibited content); least-privilege agent credentials; reversibility and human override.
- **Knowledge**: agents may use RAG/RLM over the documentation (see `RLM_RAG_HANDOFF.md`).

## 🔭 Ecosystem Expansion — Multi-Sided Platform (strategic vision)

> **Status:** vision / idea-stage (recorded 2026-06-30). Promotes to MVP scope only via a formal Change Request. Reviewed cross-functionally by **architect · growth · finance · legal · ux-designer · security**.

### Framing
ZooLink evolves from an *animal-listing marketplace* into a **multi-sided ecosystem**: animals + **services** + **goods** + **expertise/consulting**, bound by a cross-cutting **"find-nearby"** discovery layer. The animal sale is the **acquisition hook** (a rare, high-trust event); recurring **services and goods are the retention engine**. The owner's explicit apex business requirement — **convenience & comfort drive acquisition and retention** — is realized as *"everything your animal needs, nearby, for its whole life — in one search, one profile, one inbox."*

### A. New sides (participants & offerings)
- **Services** — providers with no animal of their own, offering: veterinary, grooming, dog-walking, boarding/pet-sitting (*передержка*), training/cynology; **animal hotels** with the same service catalogue. Modeled as a new `ServiceOffering` aggregate — a service has no subject-animal and no sale lifecycle, so it is **not** another `listing_type`.
- **Goods** — sellers with products: farmers, pet stores, **(non-Rx)** feed & accessories. Feed is a consumable → **re-order / subscription** (the strongest LTV driver). Modeled as `ProductOffering`.
  - 🔴 **Pharmacies / prescription (Rx) veterinary medicines — OFF at launch, separate gated track.** Distance sale of Rx medicines is restricted in RF (61-ФЗ; Gov. Decree №697/2020; drug advertising 38-ФЗ ст.24). At launch open **only non-medicinal goods** (feed, accessories, care). Rx is a `feature_toggle`-OFF track requiring a licensed pharmacy partner + a legal opinion before enabling (mirrors the `feature_toggles.payments` "form exists, behavior deferred" pattern). *(Decision locked by owner, 2026-06-30.)*
- **Expertise / consulting** — legal support of a transaction, document preparation. Modeled as `ConsultationOffering`, a **sub-type of service**; the provider may be `principal_type=AGENT` (ADR-0006). Disclaimer: informational, **not** advocacy or veterinary care; human-override required on document issuance.
- **Find-nearby ("рядом")** — **not** a separate side but a **cross-cutting activation layer**: map/list toggle, filters (type, open-now, rating, price, distance), "near me". Builds on `docs/specs/07-geo-search-service.md`.

### B. Architectural spine (settle by ADR before any code)
- **Thin "Offering" seam** — a polymorphic key (offering-type + id) across discovery / moderation / favorites / saved-search, plus a `market_scope` tag (pet | livestock | both) and a first-class `geo-anchor`. Search & moderation are built **once**, polymorphically, for all offering types — the architectural carrier of the apex comfort BR.
- **Sub-type aggregates:** `AnimalListing` (existing), `ServiceOffering`, `ProductOffering`, `ConsultationOffering` — **no** god-table / EAV (anti-pattern: build sub-type tables only when that side is implemented).
- **Provider abstraction:** organization-backed (clinic/hotel — `organization-domain` already models this) | individual (solo groomer) | agent (AI lawyer/consultant).
- **ADR-0002 is clarified, not broken:** the hard pet/livestock split governs *animal listings*; services & goods are **cross-market verticals** distinguished by the logical `market_scope` tag, **not** a physical third split. Discovery must still enforce `market_scope` so the two markets never bleed.

### C. Cross-cutting business requirements
**Convenience / comfort (apex BR — ux):**
- One account, **progressive just-in-time roles** (buyer → seller → service provider → goods seller; the role activates at first action, no re-registration).
- Find-nearby as the primary entry point (shortest time-to-first-value).
- A **unified provider / organization profile** (services + goods + listings + reviews + verification + hours + contact).
- Service **booking lifecycle**: request/slot → confirmed → completed → review, with reminders and a clear status at every step.
- Trust as a through-layer; seamless cross-vertical transitions ("continue where you left off"); perceived speed (optimistic UI, draft autosave); **accessibility (WCAG 2.1 AA) + RU/EN localization** as part of comfort.

**Trust & security (security):**
- **Risk-proportional provider verification** (vet/pharmacy/cynologist = license/diploma → high-trust badge; groomer/walker/sitter = verified identity + phone).
- **Object-level authorization on every new object** (ServiceOffering, bookings, orders, expertise documents) — IDOR/broken-access-control is the codebase's #1 recurring risk; 404-no-leak.
- **Escrow + keep-the-deal-in-platform** (anti "paid upfront, vanished"); server-side integer minor-unit money; signed & idempotent payment webhooks.
- **Reviews only with proof-of-transaction** (anti-astroturfing); append-only reputation with human-override (ADR-0011).
- **Agent-as-principal least-privilege** for the AI-expertise side + full audit + human-override on issuance (ADR-0006).
- **Geo privacy:** coarsened location (geohash/radius); exact address revealed to the provider only after a confirmed booking (ФЗ-152).

**Monetization (finance — gated by `feature_toggles`):**
- **First (no `payments`; we stay an information intermediary → no 54-ФЗ fiscal burden):** `vet_leadgen` (cost-per-lead), `boosted_listings` (promotion), `premium_profiles` (provider subscription / MRR).
- **Then:** `service_marketplace` (lead-gen mode → later in-app booking / take-rate).
- **New toggle to register:** `goods_marketplace` (flagged to architect).
- **Last:** `payments` / escrow (take-rate on GMV) — enable only when GMV covers 54-ФЗ / 115-ФЗ / acquiring compliance cost; livestock (high ticket) amortizes it earlier than pet.
- Record a per-side **monetization-type** field (lead-gen | subscription | take-rate) so the model is switchable without a refactor.

**Legal (legal — RF-first; analysis dated 2026-06-30, re-verify norms before enabling a regulated side):**
- Preserve **information-intermediary** status (ст.1253.1 ГК) + **aggregator** duties (ЗоЗПП ст.9/12); the immunity is lost if the platform / AI "slides" into being the performer or guarantor.
- **Provider license verification is a condition of the intermediary immunity** for regulated categories (vet license & ВетИС/«Меркурий» for animal/product movement, 498-ФЗ).
- Extend the public offer / ToS per side; ФЗ-152 basis for new PII (geo, provider documents); AI-expertise disclaimers; a reviews takedown procedure (ст.152 ГК, 149-ФЗ).

### D. Launch sequencing (growth — strict; not "all at once")
1. **PET services via the find-nearby directory** (groomer / walker / vet / sitter / cynologist) — seeded against existing buyer demand, catches the post-purchase moment. **First.**
2. **PET goods** as a shop/pharmacy *directory → lead-gen → transactional* (feed re-order is the retention prize, but heavy ops).
3. **Expertise on the transaction core** (legal support) — a light, assisted version; a trust/conversion differentiator vs Avito.
4. **Livestock services / goods** — a **separate B2B track** (ADR-0002): different participants & channels (large-animal vets, bulk feed, ВетИС, transport).

> **Principle:** drive *one* category to liquidity before opening the next — each new category is its own two-sided cold-start, not a free feature add. Top growth risk = thin supply everywhere → "groomer nearby: 0 results" kills the comfort promise.

**North-star (accepted 2026-06-30):** **frequency × breadth** — completed value-events (sale / service booking / order) per active animal-household per period; proxy = *share of an animal's needs closed on ZooLink*. Rewards repeat over the one-off sale; final instrumentation calibration with data-analyst.

### E. Orchestrator additions (cross-lens)
- **Animal profile as the spine (leverages ADR-0004):** make the existing Animal aggregate the persistent hub — vaccination/vet history, food subscription, training progress, documents all attach to a *specific animal* → switching cost + retention spine (extends the "digital health passport" item above).
- **Reverse marketplace / "Запрос" (demand-posted):** a buyer posts a need ("a walk in district X tomorrow at 18:00"); providers respond. Solves cold-start from the **demand side** — value shows without dense supply yet.
- **Unifying narrative** — *"everything for your pet, nearby, for its whole life"* — the brand frame (vs Avito's one-off transaction), driven by the **animal-lifecycle** engine (puppy → training; adult → grooming/food/vet; travel → boarding).

### F. Phasing — form-now (anti-rewrite) vs deferred behind toggles
**Form-now (cheap as a seam, expensive to retrofit — settle via architect/alpha-analyst when we build):**
- Polymorphic discovery/moderation/favorites/saved-search key (offering-type + id); `market_scope` on the offer abstraction; first-class `geo-anchor` (point now, room for service-area); a reserved Reviews/Reputation seam over provider+offering; the multi-role account model + progressive-onboarding pattern; the per-side monetization-type field; agent-ready actor recording (already in ADR-0006/0011).

**Deferred behind `feature_toggles` (document here, do not code now):**
- The real ServiceOffering / ProductOffering / ConsultationOffering tables & modules; the Booking/Scheduling bounded context; full e-commerce (inventory/cart/orders) + its payments/tax; the Reviews/Ratings implementation; PostGIS area-matching; the Rx/pharma track; real escrow / `payments` processing.

### G. ADRs to raise (when we commit to build — via architect)
- **ADR-A** — Offering supertype / polymorphic discovery+moderation seam (the main structural one; explicitly anti-god-table).
- **ADR-B** — Clarify ADR-0002 scope (the market split governs animal listings; services/products are cross-market via `market_scope`).
- **ADR-C** — Provider model (organization | individual | agent-provider; ties to ADR-0006).
- **ADR-D** (later) — Booking/Scheduling bounded context.
- **ADR-E** (later) — Reviews/Reputation domain.

---

**Provenance / rationale (WHAT / WHY / WHY-BETTER):**
- **WHAT:** added a strategic "Ecosystem Expansion" section consolidating the owner's ideas (services, goods, expertise, find-nearby) plus a 6-lens cross-functional review into a structured, sequenced vision — architectural spine, monetization/legal/trust gates, north-star, and a form-now-vs-deferred phasing.
- **WHY:** the owner is broadening the product into a multi-sided ecosystem with *convenience/comfort* as an apex acquisition/retention BR; previously scattered items (service-marketplace, e-commerce, lead-gen) needed consolidation into one coherent, risk-gated plan.
- **WHY-BETTER for the whole project:** keeps every idea tracked (truth-hierarchy — business reqs are apex, nothing dropped silently); aligns with ADR-0002 (clarified, not broken), ADR-0004 (animal spine), ADR-0006/0011 (agent-as-principal, audit); defers cost/compliance-heavy work behind toggles while reserving cheap-now seams to avoid future rewrites; respects RF regulation (61-ФЗ → Rx OFF, ФЗ-152, information-intermediary status). Promotes to MVP only via a formal Change Request.

## How to Use This Document
- Review during backlog grooming and sprint planning
- Features promote to MVP scope only via formal Change Request
- Prioritize based on user feedback, business goals, and technical feasibility
- Remove features that are no longer relevant or replaced by better ideas
- Archive implemented features in a separate "Released Features" log
