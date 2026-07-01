# User Flows for ZooLink

## Overview
This document describes the key user journeys in the ZooLink system, covering the main roles: regular user (seller/buyer), breeder/farmer, moderator, and administrator.

## 1. Registration and authentication
### 1.1 Registration via phone
1. The user provides a phone number
2. The system sends an SMS code
3. The user enters the code
4. The user fills in their name and selects a city
5. Optionally adds an email and an avatar
6. The account is created and the user is logged in

### 1.2 Registration via OAuth
1. The user clicks the "Sign in with Google" button (or another provider)
2. Redirect to the provider's authorization page
3. The user gives consent to share basic data (name, email)
4. The system creates/logs in an account linked to the OAuth ID
5. The user fills in the missing data (city) on first login

### 1.3 Signing in
- Similar to registration: the credentials are requested (SMS or OAuth) and JWT/refresh tokens are issued.

## 2. Profile management
1. The user goes to "My Profile"
2. Can edit: name, city, avatar, email, link/unlink OAuth accounts
3. Changing the phone number requires re-verification via SMS
4. There is an option to deactivate the account (hide it, unpublish listings, login disabled); it can be reactivated later.

## 3. Animal management
### 3.1 Creating an animal profile
1. The user goes to "My Animals" → "Add a new animal"
2. Selects a species from the reference catalog (dog, cat, cattle, etc.)
3. Selects a breed from the reference catalog (or specifies "Other" and enters text for moderation)
4. Specifies sex, date of birth, or an approximate age
5. Fills in the nickname (optional), color/coat
6. Optionally adds: microchip, brand/tattoo, initial health records
7. Confirms creation → the animal is saved and linked to the owner (user or organization).

### 3.2 Editing an animal
- Editable: nickname, color/coat, chip/tattoo, adding new health/reproductive records.
- Not editable: species, breed (if from the catalog), sex, date of birth (the approximation can be refined, but not changed drastically).

### 3.3 Deactivating/reactivating an animal
- Deactivate: the animal disappears from search and from the owner's list; existing listings remain active but are marked as having a deactivated animal.
- Reactivate: restores the ability to create new listings.

## 4. Creating a listing (Marketplace)
### General flow (the same for pet and livestock, with field differences)
1. The user goes to "My Listings" → "Create a listing"
2. Selects the listing type: Sale, Mating, Show, Adoption, Stud Service
3. The system offers a choice of an animal from the list of the owner's active animals (or the organization's, if the user is acting on its behalf)
4. The user fills in:
   - Title (up to 100 characters)
   - Detailed description (the limit varies: pet 2000, livestock 3000)
   - Price/terms (a number, "free", "negotiable", often with a unit of measure)
   - City (from the catalog) – used for geo-search
   - The required number of photos (min 1 for pet, min 3 recommended for livestock; uploaded via pre-signed URLs)
   - Specific fields (see below by listing type and domain)
5. The user clicks "Submit for moderation".
6. The listing now carries **two** status fields (canonical model, see `specs/statemachines/listing_state_machine.md`): the lifecycle **`status`** (set to `PENDING_MODERATION`) and the moderation outcome **`moderation_status`** (set to `PENDING`). The two fields are **not independent** — the core invariant (`status = 'ACTIVE'` is permitted only when `moderation_status = 'APPROVED'`) is stated in §5.2.

### Specific fields by listing type (Pet Marketplace)
- **Sale**: price (a number or "free"/"negotiable"), sterilization/neutering status (optional)
- **Mating**: terms (pick of the litter, fixed fee, negotiable); information about heat cycles for males/females
- **Adoption**: often free, a recommendation to donate to a shelter is possible
- **Show**: class, title, event dates
- **Stud Service**: cost per mating/per semen, etc.

### Specific fields by listing type (Livestock Marketplace)
- **Sale**: purpose (breeding, fattening, slaughter); productivity records (milk yield, weight gain)
- **Mating/Stud Service**: type (natural service, AI, embryo); guarantees (pregnancy, live offspring)
- **Show**: class, conformation scores
- **Adoption**: used less often, mainly for small livestock (goats, sheep)

## 5. Pre-moderation process
### 5.1 Reviewing the queue by the moderator
1. The moderator opens the moderation panel
2. Sees a list of listings with the `PENDING_MODERATION` status, grouped by type (pet/livestock)
3. For each listing a preview is shown: photo, species/breed, price, city.

### 5.2 Reviewing a listing
The moderator checks:
- Whether the photos match the declared species/breed and the animal
- Whether the required fields are filled in
- Compliance with the rules (no spam, no illegal content, no false claims)
- For livestock: regulatory flags are optionally noted (accompanying documentation is required for transport)
The moderator records **one of three** canonical decisions (per `specs/statemachines/listing_state_machine.md`); each sets the listing's `moderation_status` and drives its lifecycle `status`. **Core invariant (P0):** `status = 'ACTIVE'` is permitted only when `moderation_status = 'APPROVED'`.
- **Approve** → `moderation_status = APPROVED`, `status` becomes `ACTIVE`; the listing appears in search.
- **Request changes** (fixable issues) → `moderation_status = CHANGES_REQUESTED`, `status` returns to `DRAFT` with comments about the required corrections; the owner edits and resubmits (DRAFT → PENDING_MODERATION).
- **Hard reject** (policy violation, not fixable) → `moderation_status = REJECTED`, `status` becomes `DEACTIVATED` (**terminal**); the owner is notified with the reason and cannot resubmit this listing.

### 5.3 Moderation time (SLA)
- Target time: **TBD** — the exact SLA threshold is an **open decision**; candidates are 4 hours (pet) / 6 hours (livestock) during business hours (9:00–21:00), or a single 24-hour window. See [ADR-0003](../04-decisions/0003-pre-moderation-workflow.md) and the pending owner ruling (cross-team audit 2026-06-30, Q5). The numbers above are not final.
- **On SLA timeout the listing is escalated** (alert to admin/lead) and **stays in `PENDING_MODERATION`** — it is never auto-approved or auto-rejected (per `specs/statemachines/listing_state_machine.md`).

## 6. Searching and viewing listings
### 6.1 Search
1. The user (authorized or guest) lands on the main search page
2. Can specify:
   - Animal species (dog, cat, cattle, etc.)
   - Breed (from the catalog, with "Mixed/Unknown" support)
   - Sex
   - Age range (from/to in years/months)
   - Search radius from the city (1–100 km)
   - Price range (for a sale) or terms (free, negotiable)
   - Additional filters:
        - Pet: temperament (friendly with children, with dogs/cats), vaccinations, presence of a veterinary passport
        - Livestock: productivity (milk yield, egg production), genetic traits (polled, hornless sheep), sanitary certificates (TB-free, Brucellosis-free)
   - A restriction by organization/branch (if logged in as an organization representative)
3. Clicks "Search".

### 6.2 Search results
Listing cards are displayed:
- Photo thumbnail
- Title, species/breed, sex, age
- Price/terms
- Distance from the user
- Organization/branch badge (if applicable)
- A "Verified Breeder" or "Vaccinated" badge (if the data is available)
Clicking a card opens the listing's detail page.

### 6.3 Listing page
- A carousel of all photos
- Full description
- Animal data (species, breed, sex, approximate age, nickname, coat, health/reproductive notes – depend on the type and the owner's consent)
- Specific fields (productivity, health, mating terms, etc.)
- A "Show contacts" button. Revealing contacts (`POST /api/v1/listings/{id}/contact-reveal`) has these **preconditions** (per [16-contact-exchange.md](../specs/16-contact-exchange.md)):
    - **Authentication required** — a guest must sign in first; an anonymous reveal is rejected.
    - The listing **must be `ACTIVE`** (contact is exposed only after moderation approval).
    - The caller **must not be the seller** (a self-reveal is rejected).
    When the preconditions hold and the button is clicked:
    - The system logs the reveal in `contact_reveals` (who, when, which listing) for owner stats and abuse detection.
    - It returns **only the channels the seller enabled** in `contact_prefs`: the phone (if `show_phone`) and/or Telegram/VK links (if linked and `show_telegram`). If the seller enabled **no** channels, there is nothing to reveal (empty result).
    - The exact address is **never** shown.
    - **Rate limit:** 10 reveals/hour/user (pet) or 5/hour/user (livestock); exceeding returns `429` with a `Retry-After` header.

## 7. Post-view interaction (Contact)
1. An **authenticated** user interested in an `ACTIVE` listing clicks "Show contacts" (preconditions and rate limits per §6.3 and [16-contact-exchange.md](../specs/16-contact-exchange.md); a self-reveal by the seller is rejected).
2. The system returns the seller-enabled contact channels (or the organization representative's); if the seller enabled none, nothing is revealed.
3. The user gets in touch off-platform (phone, messengers) to discuss the deal details and arrange a meeting.
4. After a successful deal (as agreed by the parties), **only the listing owner (seller)** can mark the listing as `SOLD` in their account (canonical lifecycle value per `database_schema.sql` / `specs/statemachines/listing_state_machine.md`; the buyer cannot). Marking `SOLD` does **not** auto-transfer animal ownership — that is the separate, explicit owner-initiated transfer flow ([ADR-0013](../04-decisions/0013-mvp-ownership-transfer.md)).

## 8. Analytics and statistics
### 8.1 For the listing owner
- In the "My Listings" section the user can select a listing and view statistics:
    - Number of views (appearances in search results)
    - Number of contact reveals
    - Dates of the latest actions

### 8.2 For an animal (optional, future)
- It may be possible to see the history of listings associated with this animal.

## 9. Moderator and Administrator
### 9.1 Moderator
- Reviews the queue of listings for pre-moderation
- Records one of the **three** canonical decisions with comments — approve / request changes / hard-reject (see §5.2)
- Can block users for rule violations
- Manages the species/breed reference catalogs (via the admin panel linked to the Admin domain)

### 9.2 Administrator
- All moderator rights, plus:
- Assigning moderator/admin roles
- Viewing system analytics (number of users, listings, activity)
- Managing global settings (limit pricing, moderation rules, etc.)

---

## Change note (alignment to canonical specs — audit 2026-06-30)
> **WHAT:** aligned the moderation, mark-sold, and contact-reveal flows to the validated contract — (1) moderation is now the canonical **3-valued** decision (Approve→ACTIVE / Request changes→DRAFT / **hard-Reject→DEACTIVATED terminal**) instead of binary Approve/Reject-to-DRAFT (§5.2, §9.1); (2) "mark `COMPLETED`" → **`SOLD`, owner-only** (§7.4); (3) the two-field model **`status` vs `moderation_status`** is introduced explicitly (§4.6, §5.2); (4) contact-reveal preconditions (auth required, ACTIVE-only, no self-reveal, seller-enabled-channels-only with empty-channels case, 429+`Retry-After`) added (§6.3, §7); (5) SLA threshold marked **TBD** with the escalate-stays-PENDING behavior made explicit (§5.3).
> **WHY:** the prior text contradicted the canonical sources — `specs/statemachines/listing_state_machine.md` (3-valued decision, hard-REJECT→DEACTIVATED terminal, SOLD via owner-mark, P0 ACTIVE-requires-APPROVED), `database_schema.sql` (`status` enum has `SOLD`, not `COMPLETED`), and `specs/16-contact-exchange.md` (auth/ACTIVE/self/rate-limit gating). A UX doc that taught a non-existent `COMPLETED` status and a binary moderation model would mislead frontend and QA.
> **WHY-BETTER-for-the-whole-project:** these are corrections *toward* the validated contract (truth tiers 3–5), not new decisions — they remove doc↔spec drift flagged by the audit without inventing rules. The numeric SLA threshold and the reversibility of a user/account `DEACTIVATED` state are deliberately **left out** (open owner/architect decisions — audit Q5 and a pending ADR); only schema-shaping GAP-BA items go to architect.

---
*This is a living document and may be refined as mockups are developed and feedback is received from users and stakeholders.*
