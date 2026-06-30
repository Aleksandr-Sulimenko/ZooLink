# Legal artifacts — ZooLink   (STATUS: DRAFT)

> **These are DRAFTS prepared by the `legal` agent for the owner's review. They are NOT executed,
> NOT published, and do NOT constitute legal advice from a licensed attorney.** The owner must
> (1) finalise the operator's identity (ИП / ООО / самозанятый — fill every `[…]` placeholder),
> (2) have them reviewed by retained RF counsel before publication, and (3) publish + link them in
> the product footer. Only then is the lawful basis for processing PII (ст.6 ч.1 п.5 ФЗ-152) actually
> grounded. See `launch-compliance-checklist.md`.
>
> **Jurisdiction:** Russian Federation. **The RU version (`docsRU/legal/`) is the legally operative
> text** for RF users; this EN copy is a working translation for the team. Analysis dated 2026-06-30 —
> verify each cited norm is still in force before relying on it.

## Inventory
| File | RU equivalent | Russian name | What it is |
|---|---|---|---|
| `public-offer.md` | `публичная оферта` | Публичная оферта (договор) | Master contract between Operator and User (ст.435, 437–438 ГК РФ). Acceptance = registration. The contract that grounds the ФЗ-152 ст.6 ч.1 п.5 lawful basis. |
| `terms-of-service.md` | `правила площадки` | Пользовательское соглашение / Правила площадки | Rules of use incorporated into the offer: conduct, listing rules per market, prohibited/restricted goods & species, moderation & appeals, contact-reveal, UGC licence, sanctions. |
| `privacy-policy.md` | `политика конфиденциальности` | Политика обработки персональных данных (ФЗ-152) | The ст.18.1 ч.2 п.2 published policy: purposes, PII categories, lawful bases, recipients, localisation, retention, subject rights, erasure. |
| `consent-personal-data.md` | `согласие на обработку ПДн` | Согласия на обработку ПДн | The **separate** ст.9 consent(s) for non-essential processing (marketing, analytics, cookies) **and** the ст.10.1 consent на **распространение** (publishing contacts in listings). Never bundled with the offer. |
| `launch-compliance-checklist.md` | — | Чеклист правовой готовности к запуску | The legal Definition-of-Done gate before go-live (РКН notification, localisation, publication, ОРИ assessment, etc.). |

## How the documents relate
- The **public offer** is the master agreement. The **terms of service / rules** are incorporated into it by reference.
- Core platform processing runs on **contract performance** (ст.6 ч.1 п.5 ФЗ-152) — *no consent needed*, the offer is the contract.
- The **privacy policy** is the public ФЗ-152 disclosure document (must be published before processing).
- The **consent form** covers only what the contract does *not* cover: marketing, analytics, cookies (ст.9) and contact distribution (ст.10.1). Each consent is granular and independently revocable.
- Two markets (**pet** vs **livestock**, ADR-0002) carry different legal regimes — divergences are marked inline.

## Owner sign-off log
| Document | Reviewed by counsel | Owner approved | Published | Date |
|---|---|---|---|---|
| public-offer | ☐ | ☐ | ☐ | |
| terms-of-service | ☐ | ☐ | ☐ | |
| privacy-policy | ☐ | ☐ | ☐ | |
| consent-personal-data | ☐ | ☐ | ☐ | |
