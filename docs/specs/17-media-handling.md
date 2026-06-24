---
version: "1.0"
lastUpdated: "2026-06-18"
author: "Architecture Review Board"
status: "Approved"
---

# Spec: Media & File Handling (photos, avatars, logos)

## Outcome
Define the end-to-end media pipeline (pre-signed S3 upload, validation, variants, lifecycle, privacy) so a backend
team can implement uploads without inventing the contract. Closes the round-5 media gap. Aligns with ADR-0001
(pre-signed URLs) and ADR-0008 (RF object storage / CDN).

## 1. Upload flow (pre-signed, normative)
1. Client → `POST /api/v1/uploads` `{ purpose: "listing_photo|avatar|org_logo", content_type, byte_size }`
   (authenticated). Server validates limits (§2), returns `{ upload_url, object_key, headers, expires_at }`.
   The object is written under a **`tmp/` prefix**; the pre-signed PUT policy pins `Content-Type` and max size.
2. Client → `PUT` the bytes directly to `upload_url` (S3-compatible).
3. Client → attach: e.g. `POST /api/v1/listings/{id}/photos` `{ object_key, order_index }`. The server verifies the
   object exists, **moves `tmp/` → permanent prefix**, runs post-processing (§3, §5), and persists `listing_photos`.
- `listing_photos.url` stores the **object key** (immutable); the public CDN URL is derived by the server/adapter on
  read (never trust a client-supplied URL).

## 2. Validation limits (normative)
- **MIME:** `image/jpeg`, `image/png`, `image/webp` only.
- **Size:** ≤ 10 MB/file. **Dimensions:** ≤ 8000×8000 px.
- **Count:** listing photos 1–10 (`MAX_MEDIA_ITEMS=10`); **≥1 photo required** to move DRAFT→PENDING_MODERATION.
  Avatar/logo: exactly 1, ≤ 5 MB, square recommended.
- Enforced twice: in the pre-signed policy (Content-Type + Content-Length) and at attach time.

## 3. Image variants
On attach the server generates a fixed set and stores them alongside the original: `thumb` (150px), `card` (600px),
`full` (≤1600px), all re-encoded to **WebP** (original kept for download). Naming: `<key>__<variant>.webp`.
(On-the-fly CDN resizing may replace this in Фаза 2.)

## 4. Lifecycle
- `order_index` orders photos; `order_index = 0` is the primary photo. Reorder via
  `PATCH /api/v1/listings/{id}/photos` `[{photo_id, order_index}]`. Delete via `DELETE .../photos/{photoId}`.
- Photo CRUD allowed only for the listing's `seller_id` (or an org member per RBAC).
- On listing deletion `listing_photos` CASCADE-delete; a background job deletes the corresponding objects + variants.
- **Orphan cleanup:** S3 lifecycle rule expires anything under `tmp/` after 24 h; a worker job also deletes permanent
  objects with no `listing_photos`/`users.avatar_url`/`organizations.logo_url` reference (weekly).

## 5. Security & privacy
- **EXIF/GPS stripping is mandatory** on every uploaded image (ФЗ-152 — photos may carry location/owner metadata).
- **Malware scan** (ClamAV or provider) before an object leaves `tmp/`; on detection the attach is rejected and the object purged.
- Bucket is **private**; objects are served only via the CDN (signed or public-read CDN URLs), never by direct bucket access.
  CORS restricts the pre-signed PUT to the app origin(s). SSE-S3/at-rest encryption per security_specification.md.
- Image **content moderation** (NSFW) is manual in MVP: photos are reviewed with the listing during pre-moderation;
  automated analysis is Фаза 2 (ADR-0006).

## 6. CDN
Served via RF CDN (Yandex/VK/Selectel, ADR-0008). Object keys are content-addressed (include a content hash) so a
changed image gets a new key — **no cache invalidation needed**; deletes may issue a CDN purge.

## Related
- ADR-0001 (pre-signed URLs), [ADR-0008](../04-decisions/0008-rf-provider-matrix.md), `storage.md`,
  `performance_specification.md`, `security/security_specification.md`, `12-moderation-domain.md`, `data-governance.md`
- 🌐 RU mirror: [docsRU/specs/17-media-handling.md](../../docsRU/specs/17-media-handling.md)
