# Privacy Policy — Personal Data Processing (ФЗ-152) — ZooLink   (STATUS: DRAFT)

> **DRAFT for owner review — not published.** This is the policy required by **ст.18.1 ч.2 п.2 ФЗ-152**
> (publicly available document on the operator's processing policy). RU version in `docsRU/legal/` is
> operative. Fill `[…]` operator details. Aligned with `docs/specs/data-governance.md`. Analysis dated
> 2026-06-30 — verify нормы before publication.

## 1. Operator
`[Operator: ИП/ООО «…», ОГРН/ОГРНИП …, ИНН …, address …]` (the **"Operator"**) processes personal data of Platform Users as the **operator** under ФЗ-152.
**Ответственный за организацию обработки персональных данных (ст.22.1 ФЗ-152):** `[name, e-mail]`.

## 2. Scope and consent
This Policy describes how the Operator processes personal data ("PII") of Users of the ZooLink Platform. By accepting the Public Offer and using the Platform, the User confirms they are informed of this Policy. Core processing does **not** rely on consent (see §4); separate consents apply to non-essential processing and to distribution of contacts (`consent-personal-data.md`).

## 3. Categories of PII and sources
PII is provided by the User directly and generated during use (per `data-governance.md` §1 PII inventory):
| Category | Examples |
|---|---|
| Identifiers/contact | phone (stored as keyed hash for lookup), e-mail, Telegram/VK username, OAuth identifiers |
| Personal | full name, avatar |
| Profile/business | organisation INN/KPP/address (for legal-entity Sellers) |
| Listing/location | approximate location (city / lat-lng coarsened); exact address is **not** collected/published |
| Technical/behavioural | IP address, user-agent, last-login, login/session events, contact-reveal events |

## 4. Purposes and lawful bases
| Purpose | Lawful basis (ФЗ-152) |
|---|---|
| Registration, account, profile, listing, search, contact-reveal, moderation, transactional notifications — i.e. **performing the service** | **ст.6 ч.1 п.5** — performance of the contract (Public Offer) to which the User is a party. **No separate consent required.** |
| Security, fraud/abuse prevention, audit, legal-obligation record-keeping | ст.6 ч.1 п.2 / legal obligation; legitimate operation of the service |
| **Publication (distribution) of the Seller's contacts** in listings to other Users | **ст.10.1** — separate consent на распространение |
| **Marketing communications, behavioural analytics/profiling, optional cookies** | **ст.9** — separate, freely-given, revocable consent |

## 5. Processing actions and recipients (third parties / processors)
5.1. Actions: collection, recording, systematisation, storage, update, use, transfer (to processors below), depersonalisation, blocking, deletion.
5.2. Processors / recipients acting under instruction (ст.6 ч.3): `[hosting/cloud provider]`, SMS gateway `[…]`, OAuth providers (Google/Apple/Telegram/VK), geocoder `[Yandex.Maps]`, object storage (S3/MinIO). Each must be bound by a data-processing clause and located so as to satisfy §6. The Operator does not sell PII.
5.3. The Operator discloses PII to state bodies only on lawful request.

## 6. Localisation and cross-border transfer
6.1. **Localisation (ст.18 ч.5 ФЗ-152):** recording, systematisation, accumulation, storage, update and retrieval of RF citizens' PII is performed using databases **located in the Russian Federation**. (This is a binding legal precondition; the deployment topology that satisfies it is defined by the architect/devops RF-residency ADR — see `launch-compliance-checklist.md`.)
6.2. **Cross-border transfer (ст.12):** in the MVP the Operator does **not** transfer PII abroad. Any future transfer will follow ст.12 (РКН notification; transfer only to countries with adequate protection or on the bases listed in ст.12).

## 7. Retention (per `data-governance.md` §4)
| Data | Retention |
|---|---|
| Account PII | until account deletion + 30-day grace, then anonymised |
| notification_logs | 90 days, then prune/mask |
| contact_reveals | 12 months, then prune |
| audit_log | 3 years (legal/security) |
| Backups | per backup schedule; erasure re-applied on restore |
PII is processed no longer than the purposes require or the law mandates.

## 8. Data-subject rights and how to exercise them
The User may, by request to `[privacy contact]`:
- **Access (ст.14):** learn what PII is processed and obtain it (profile self-service; fuller export on request).
- **Rectification:** correct PII (profile editing).
- **Erasure / withdrawal of consent (ст.9 ч.2):** delete the account → 30-day grace → `erase_user` anonymises PII in place (UUID retained); data under legal hold (audit, moderation decisions, ownership history, financial records) is retained as the law requires.
- **Restriction:** deactivate the account.
- **Objection:** opt out of non-essential processing (withdraws the ст.9 consent).
The Operator responds within the ФЗ-152 statutory term (generally up to 10 working days, extendable as the law allows).

## 9. Security
The Operator applies organisational and technical measures to protect PII (ст.18.1, ст.19): access control, encryption in transit (TLS), at-rest protection of sensitive fields, log masking of PII, audit logging, least-privilege access. Details in `nfr/security.md`.

## 10. Cookies and similar technologies
Essential cookies (session/security) are used on the contract basis. Analytics/marketing cookies are used only with the User's consent (§4; `consent-personal-data.md`).

## 11. Changes
The Operator may update this Policy; the current version with its date is published on the Platform.

## 12. Contacts
Requests regarding PII: `[privacy contact e-mail/address]`. Supervisory authority: Роскомнадзор.

---
🌐 RU mirror: `docsRU/legal/privacy-policy.md` (legally operative text)
