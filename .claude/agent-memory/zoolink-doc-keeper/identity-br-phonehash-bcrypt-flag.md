---
name: identity-br-phonehash-bcrypt-flag
description: RESOLVED 2026-06-24 (C4). identity-BR phone_hash bcrypt→HMAC done EN+RU; kept here as the pattern record.
metadata:
  type: project
---

> **STATUS: RESOLVED 2026-06-24** as Admin-phase C4 together with C3 (passwordless) + C5 (no auto-purge) + JWT
> 15m/7d. identity-domain.md EN+RU now match canon. The note below is kept as the historical pattern.


`business-requirements/identity-domain.md` (EN **and** RU, lines ~56, ~162) still describe `phone_hash` as a
**bcrypt** hash of the phone number "for lookup". This contradicts the higher-tier source of truth:
- `data-model.md` users table comment + spec 01 round-4: `phone_hash` = **deterministic HMAC-SHA256(phone,
  server_pepper)**, unique; **NOT bcrypt** (bcrypt is salted/non-deterministic → cannot be used for lookup).
- glossary term **phone_hash (HMAC + pepper)** already states HMAC.

**Why this is NOT an EN↔RU sync defect:** EN and RU say the *same* (both "bcrypt") — the mirror is internally
consistent. It's a **content** drift vs schema/spec, so the fix is identical text change in BOTH EN+RU, owned
as **C4** (deferred), not a mechanical mirror pass. password_hash *is* legitimately bcrypt (operator-only).

**Why:** flagged during the A-phase EN↔RU consolidation sweep (2026-06-23). **How to apply:** when C4 runs,
change phone-hash wording bcrypt→HMAC in identity-BR EN+RU together; leave password_hash=bcrypt untouched.
See [[role-canon-br-sync]].
