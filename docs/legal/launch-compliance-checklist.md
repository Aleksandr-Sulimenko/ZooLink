# Legal Launch-Compliance Checklist (Legal Definition-of-Done) — ZooLink   (STATUS: DRAFT)

> The legal gate before public go-live. Each item is **owner-actionable** unless marked
> (architect/devops/backend). RF-first; analysis dated 2026-06-30 — re-verify every cited norm is
> current before launch. Ranked by severity × likelihood × cost-of-fix. RU mirror in `docsRU/legal/`.

## A. BLOCKERS — must be DONE before any public launch
| # | Requirement | Norm | Owner / role | Status |
|---|---|---|---|---|
| A1 | **Publish the Public Offer, Rules, Privacy Policy** (footer-linked, accessible before registration). Lawful basis ст.6 ч.1 п.5 is only grounded once the offer is published & accepted. | ст.435–438 ГК; ст.18.1 ч.2 п.2 ФЗ-152 | owner (finalise `docs/legal/` drafts + counsel review) | ☐ |
| A2 | **File the РКН processing notification (уведомление об обработке ПДн)** *before* starting processing. Submit via the РКН portal; keep the registry entry current. | **ст.22 ФЗ-152** | owner | ☐ |
| A3 | **Data localisation: RF-citizen PII primary storage in the RF** (recording/systematisation/storage/update/retrieval in RF databases). Legal requirement here; the deployment topology (RF-only primary + replicas) is an **ADR** owned by architect/devops. | **ст.18 ч.5 ФЗ-152** | legal sets requirement → **architect/devops** ADR + deploy constraint | ☐ |
| A4 | **Designate the ответственный за организацию обработки ПДн**; publish name + contact in the Privacy Policy. | ст.22.1 ФЗ-152 | owner | ☐ |
| A5 | **Separate consents wired** (unbundled, default-off, revocable): contact-distribution (ст.10.1), marketing (ст.9 + ФЗ-38), analytics, cookies. Core service must work if all declined. | ст.9, ст.10.1 ФЗ-152; ст.18 ФЗ-38 | owner + **frontend/backend** | ☐ |

## B. CRITICAL — do before launch or accept a documented, time-boxed risk
| # | Requirement | Norm | Role | Status |
|---|---|---|---|---|
| B1 | **Operator legal entity chosen & registered** (ИП / ООО / самозанятый). Самозанятый cannot lawfully run an employee-staffed marketplace/earn from others' services at scale — affects which monetisation is possible. | ГК; 422-ФЗ (НПД) | owner | ☐ |
| B2 | **Prohibited/restricted-species policy content** published in the Rules (CITES, Red Book, ст.258.1 УК) + moderation guidance; `prohibited_species` reason already seeded. | CITES; ст.258.1 УК РФ; 498-ФЗ | owner + moderation | ☐ |
| B3 | **Livestock vet disclaimer** actually shipped: Platform does not issue/verify ВетИС/«Меркурий» certificates in MVP; Seller/Buyer handle off-platform. Defensible only while the disclaimer is published. | Закон РФ «О ветеринарии»; ВетИС | owner (Rules §4.3) | ☐ |
| B4 | **Takedown / abuse channel** published; intermediary-liability posture documented. | ГК ст.1253.1; ФЗ-149 ст.10 | owner | ☐ |
| B5 | **Automated-decision disclosure + human-appeal** path live (AI operators). | ADR-0006; transparency principle | owner + product | ☐ |
| B6 | **Incident-response clock corrected** in runbook: РКН notice **24h (fact) + 72h (investigation)**. | ст.21 ч.3.1 ФЗ-152 | devops/security (runbook); legal (done in `nfr/security.md`) | ☐ |

## C. Conditional — only when the relevant toggle is flipped ON
| # | Trigger | Requirement | Norm |
|---|---|---|---|
| C1 | `feature_toggles.payments` ON, or any **own paid service** (boost/premium) | **54-ФЗ онлайн-касса/чеки**; choose marketplace vs payment-agent model; ЗоЗПП for own services. NB: boost/premium are the Operator's *own* B2C services → 54-ФЗ applies regardless of the `payments` toggle. | 54-ФЗ; ЗоЗПП |
| C2 | Operator **holds user funds** / escrow | 115-ФЗ AML touchpoints; payment-agent/escrow legality; banking-law limits. | 115-ФЗ; 161-ФЗ |
| C3 | Marketing messaging launched | ФЗ-38 ст.18 prior opt-in; unsubscribe in every message. | ФЗ-38 |
| C4 | In-app **chat/messenger** added (post-MVP) | **Re-assess ОРИ status (организатор распространения информации, 149-ФЗ ст.10.1)** — likely triggers registry + data-retention duties. | 149-ФЗ ст.10.1 |
| C5 | Cross-border data transfer introduced | ст.12 ФЗ-152 transfer notification & adequacy. | ст.12 ФЗ-152 |
| C6 | Vet-cert / ВетИС integration (livestock, later phase) | Integrate «Меркурий»; possibly become a regulated participant. | ВетИС rules |

## D. Standing posture notes (current assessment)
- **ОРИ (организатор распространения информации) — N/A in MVP.** Rationale: there is **no in-app chat/messaging** (ADR-0005); the Platform hosts listings, not user-to-user message exchange. Re-assess immediately if a messenger/chat is added (see C4). Confidence: medium-high — depends on how broadly "обмен сообщениями" is read; verify against current РКН practice.
- **Payments out of 54-ФЗ/115-ФЗ scope in MVP** because `feature_toggles.payments` is OFF and the Operator neither charges nor holds funds — *correct*. Flips the moment any own paid service launches (C1).
- **Erasure / ФЗ-152 subject rights** — erasure is **implemented** (MVP), not deferred (`data-governance.md` §2). Strength, not gap.
- **Information-intermediary shield (ГК ст.1253.1)** holds only while the Operator stays a neutral venue with a working takedown channel (B4) and does not author/curate Content beyond lawful moderation.
- **IP / trademark (Роспатент):** clearing & registering the "ZooLink" trademark is recommended pre/early-launch to protect the brand — owner action, not a blocker.

## E. Sign-off
Legal go-live recommendation requires **all A-items DONE** and **B-items either DONE or explicitly risk-accepted by the owner with a date**. Final go/no-go and signatures are the **owner's**; this checklist is advisory.

---
🌐 RU mirror: `docsRU/legal/launch-compliance-checklist.md` (operative)
