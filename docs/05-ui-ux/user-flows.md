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
6. The listing status changes to `PENDING_MODERATION`.

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
The moderator can:
- **Approve** → the status becomes `PUBLISHED`, the listing appears in search
- **Reject** → the status returns to `DRAFT` with comments about the required corrections; the owner can fix the issues and resubmit.

### 5.3 Moderation time
- Target time: under 4 hours during business hours (9:00–21:00) for pet, under 6 hours for livestock.

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
- A "Show contacts" button (available only after the `PUBLISHED` status)
    When clicked:
    - The system logs the request (who, when, which listing)
    - Shows the phone number (if the owner allowed it to be shown) and links to Telegram/VK profiles (if linked and allowed)
    - The exact address is NOT shown

## 7. Post-view interaction (Contact)
1. A user interested in a listing clicks "Show contacts"
2. The system shows the owner's contact information (or the organization representative's)
3. The user gets in touch off-platform (phone, messengers) to discuss the deal details and arrange a meeting.
4. After a successful deal (as agreed by the parties), a participant can mark the listing as `COMPLETED` in their account (for statistics and feedback).

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
- Approves/rejects with comments
- Can block users for rule violations
- Manages the species/breed reference catalogs (via the admin panel linked to the Admin domain)

### 9.2 Administrator
- All moderator rights, plus:
- Assigning moderator/admin roles
- Viewing system analytics (number of users, listings, activity)
- Managing global settings (limit pricing, moderation rules, etc.)

---
*This is a living document and may be refined as mockups are developed and feedback is received from users and stakeholders.*
