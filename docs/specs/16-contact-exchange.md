---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Spec: Contact Exchange (MVP — no chat)

## Outcome
Define how a buyer reaches a seller in the MVP, since built-in chat is out of scope ([ADR-0005](../04-decisions/0005-no-chat-mvp.md)).
This closes the broken seam where the user journey ended at "contact seller" with no mechanism. The chat tables
(`conversations`, `messages`) remain in the schema **reserved for Фаза 2+** and are not used by the MVP backend.

## Mechanism
On an **ACTIVE** listing, an **authenticated** user requests the seller's contact via
`POST /api/v1/listings/{id}/contact-reveal`. The API returns the seller's shareable contact channels
(per the seller's `users.contact_prefs`) and **logs the reveal** in `contact_reveals`.

- **Gating:** caller must be authenticated; listing.status must be `ACTIVE`; caller ≠ seller.
- **What is revealed:** only channels the seller enabled in `contact_prefs` — `contact_phone` (if `show_phone`)
  and/or `contact_telegram` (if `show_telegram`). Nothing else (no email, no full name beyond display).
- **Persistence:** one `contact_reveals(listing_id, viewer_id, seller_id)` row per reveal (audit + owner stats +
  abuse detection). Phone/telegram are stored on `users` as displayable fields (distinct from `phone_hash` used for auth).

## Rate limiting (anti-scraping, ФЗ-152 data-minimisation)
Hard limit in Redis keyed by `viewer_id`:
- **Pet marketplace:** 10 reveals / hour / user.
- **Livestock marketplace:** 5 reveals / hour / user.
Exceeding → `429` with `Retry-After` (per `nfr/security.md` and `API_CONVENTIONS.md` §8). `contact_reveals` is the
durable audit; the per-hour counter lives in Redis.

## Privacy (ФЗ-152)
Contact is exposed **only after moderation** (listing is ACTIVE ⇒ APPROVED) and **only on explicit reveal**, never
in list/search responses. Sellers control exposure via `contact_prefs`. Reveals are logged for accountability.

## Data
- `users.contact_phone`, `users.contact_telegram`, `users.contact_prefs` (JSONB `{show_phone, show_telegram}`) — migration 0005.
- `contact_reveals(id, listing_id, viewer_id, seller_id, created_at)` — migration 0005.

## Event
A reveal emits `ContactReveal.Created` (see [event-catalog.md](event-catalog.md)) for owner statistics.

## Verification
- Unauthenticated / non-active-listing / self reveal → rejected.
- 11th pet reveal within an hour → `429`.
- Only seller-enabled channels returned.

## Related
- [ADR-0005](../04-decisions/0005-no-chat-mvp.md), [event-catalog.md](event-catalog.md), `nfr/security.md`, `security/rbac-matrix.md`
- 🌐 RU mirror: [docsRU/specs/16-contact-exchange.md](../../docsRU/specs/16-contact-exchange.md)
