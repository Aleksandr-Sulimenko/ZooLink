---
version: "1.2"
lastUpdated: "2026-05-29"
author: "System Analyst"
status: "Approved"
---

# Glossary of ZooLink Terms

**User**  
An entity representing a person interacting with the ZooLink system (buyer, seller, moderator, administrator). Authenticated via the Identity Domain.

**Advertisement**  
A record in the Pet Marketplace Domain or Livestock Marketplace Domain describing an animal or related good/service for sale, rent, breeding, etc.

**Geo‑search**  
Functionality to search for advertisements within a given radius (e.g., 1-100 km) from the user's current location, implemented via the Geo‑Search Service.

**152‑ФЗ**  
Federal Law of the Russian Federation "On Personal Data" No. 152‑ФЗ dated July 27, 2006, regulating the processing of personal data.

**SMS provider**  
External service providing the ability to send and receive SMS messages (e.g., for two-factor authentication).

**Yandex.Maps API**  
Cartographic data and geocoding service from Yandex, used for displaying maps and calculating distances.

**Payment gateway**  
External service for processing online payments (to be implemented in future phases).

**Cloud storage**  
Object storage service (e.g., Amazon S3 or equivalent) for media files (photos, videos of advertisements).

**Health Records**  
A JSONB array column in the `animals` table storing veterinary health events. Each object contains:
- `type` (string): Type of health record (e.g., vaccination, deworming, check-up)
- `detail` (string): Specific detail (e.g., Rabies vaccine, Panacur deworming)
- `date` (date, ISO 8601 string): Date of the health event
- `provider` (string): Veterinary clinic or provider name
Example: `[{"type":"vaccination","detail":"Rabies","date":"2024-05-10","provider":"Green Vet Clinic"}]`

**Reproductive Data**  
A JSONB array column in the `animals` table storing reproductive events (primarily for females). Each object contains:
- `event` (string): Event type (e.g., heat_start, mating, pregnancy_confirmation, birth)
- `date` (date, ISO 8601 string): Date of the event
- `partner_id` (UUID, nullable): Reference to the partner animal (if applicable)
Example: `[{"event":"heat_start","date":"2024-06-01","partner_id":"550e8400-e29b-41d4-a716-446655440000"}]`

**Metadata**  
A JSONB column used for extensibility in various tables (`organizations`, `branches`, `listings`). Stores custom attributes as key-value pairs.
- In `organizations`: subscription tier, branding preferences, etc.
- In `branches`: center-specific attributes (e.g., specialization, facilities).
- In `listings`: experimental attributes (social media links, video URL placeholder, etc.).
Default value is `'{}'::jsonb` (empty object).
Example: `{"subscription_tier":"premium","branding":{"primary_color":"#FF5733"}}`