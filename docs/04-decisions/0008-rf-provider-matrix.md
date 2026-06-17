# ADR-0008: RF-appropriate third-party provider matrix

**Status**: Accepted
**Date**: 2026-06-17

## Context and Problem Statement

[ADR-0001](0001-tech-stack.md) and the architecture diagrams name several third-party providers that are
**unavailable or unreliable for a Russian-market product** due to sanctions and payment restrictions:
Stripe, PayPal, Twilio, SendGrid, Datadog/New Relic, and AWS/CloudFront/Cloudflare. The audit
(`BACKEND_TECH_AUDIT.md`, Sub-agent 3) classified this as a **release blocker**: code written against these
defaults would not work in production.

ADR-0001 already mandates **abstraction layers** for SMS, OAuth, mapping, and storage, so the fix is to swap
**defaults**, not architecture. This ADR fixes the canonical RF provider set.

## Decision Drivers

- **RF availability**: provider must accept RF customers and payments.
- **Compliance**: payments must support **54-ФЗ** (fiscal receipts) and PCI DSS on the provider side; PII per **ФЗ-152**.
- **Abstraction**: every external provider sits behind an interface; swapping vendors must not touch domain code.
- **Cost / self-hostability**: prefer self-hostable where it removes a billing dependency (monitoring, storage).

## Considered Options

Per capability, the realistic RF options were compared (acquiring: ЮKassa vs Т-Касса vs CloudPayments;
SMS: SMS.RU vs SMSC vs MTS Exolve; etc.). The decision records the **default** plus accepted **alternatives**;
because each capability is behind an interface, alternatives remain drop-in.

## Decision

Adopt the following **canonical provider matrix**. The MVP implements the interface for each capability;
concrete vendors marked *Фаза 2+* are deferred but their interface is defined now.

| Capability | ❌ Must NOT use (RF-blocked) | ✅ Default | Accepted alternatives | Phase |
|---|---|---|---|---|
| **Payments / acquiring** | Stripe, PayPal | **ЮKassa + СБП** | Т-Касса (Тинькофф), CloudPayments, Robokassa | Фаза 2+ (gated by `feature_toggles.payments`) |
| **SMS** | Twilio | **SMS.RU** | SMSC.RU, MTS Exolve, SMS Aero | MVP |
| **Email (transactional)** | SendGrid | **Unisender** | Mailopost, RF-hoster SMTP relay | MVP |
| **Maps / geocoding** | — | **Yandex.Maps** | 2GIS | MVP |
| **OAuth** | — | **Google, Apple, Telegram, VK** | — | MVP |
| **Object storage** | AWS S3 | **Yandex Object Storage** | VK Cloud, Selectel, self-hosted MinIO (also dev) | MVP |
| **CDN** | CloudFront, Cloudflare | **Yandex Cloud CDN** | VK Cloud CDN, Selectel CDN, Ngenix | MVP |
| **Monitoring / APM** | Datadog, New Relic | **Prometheus + Grafana** | VictoriaMetrics, Yandex Monitoring | MVP |
| **Error tracking** | — | **Sentry (self-hosted)** | GlitchTip | MVP |

## Consequences

### Positive
- Production works in RF from day one; no rewrite when leaving the validation phase.
- Self-hosted monitoring/storage/error-tracking remove foreign-billing dependencies.
- Abstractions keep vendor choice reversible.

### Negative
- Some RF providers have thinner SDKs/docs than global incumbents → a little more integration work per adapter.
- Payments add **54-ФЗ** fiscalization (online receipts) obligations — must be handled in the Payment domain.

### Neutral
- Yandex.Maps was already the chosen maps provider in ADR-0001 — unchanged.

## Implementation Notes

- Each capability behind a port/interface: `SmsProvider`, `EmailProvider`, `PaymentProvider`, `MapsProvider`,
  `ObjectStorage`, `Metrics`. Adapters per concrete vendor; vendor chosen via config/env.
- **Payments** stay behind `feature_toggles.payments` (see schema) and `specs/14-payment-domain.md`; integrate
  54-ФЗ receipt issuance via the provider's fiscalization (ЮKassa supports this).
- **PII / ФЗ-152**: keep personal data within RF infrastructure; do not export PII to RF-blocked SaaS.
- Update `specs/13-notification-domain.md` and `specs/14-payment-domain.md` to reference this matrix.

## Related Decisions

- [ADR-0001](0001-tech-stack.md): named the original (RF-blocked) defaults and the abstraction principle.
- [ADR-0009](0009-mvp-vs-target-architecture.md): MVP infrastructure topology that hosts these providers.

## References

- `BACKEND_TECH_AUDIT.md` — Sub-agent 3 (Security & Infrastructure).
- ФЗ-152 «О персональных данных»; 54-ФЗ (ККТ / онлайн-кассы); PCI DSS v4.0.
