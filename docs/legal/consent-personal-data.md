# Consents for Personal Data Processing — ZooLink   (STATUS: DRAFT)

> **DRAFT for owner review.** These are the **separate** consents required *in addition to* the
> contract. Core service processing runs on **ст.6 ч.1 п.5 ФЗ-152** (contract) and needs **no**
> consent — do **not** bundle these consents with offer acceptance (ст.9 ч.1 "freely given").
> Each consent below must be a **distinct, unticked, independently revocable** action in the UI.
> RU version in `docsRU/legal/` is operative. Analysis dated 2026-06-30.

## Design rules (binding on the frontend implementation)
1. **Granular** — each consent is a separate checkbox/toggle, default OFF, never pre-checked.
2. **Unbundled** — registration/acceptance of the offer must succeed even if all consents below are declined (service still works on the contract basis; only the consented extras are disabled).
3. **Revocable** — each consent can be withdrawn at any time in profile settings, with the same ease as giving it; withdrawal logged (`audit_log`).
4. **Recorded** — store consent text version, timestamp, and the UI action (proof of consent).

---

## Consent 1 — Distribution of contacts in listings (ст.10.1 ФЗ-152) — Seller
> Required for the contact-reveal feature. Without it, a Seller's listing cannot expose contacts.

«Я, субъект персональных данных, в соответствии со **ст.10.1 ФЗ-152** даю согласие на **распространение** (предоставление неограниченному / определённому кругу лиц — Пользователям Платформы) следующих моих персональных данных в составе моих объявлений: `[указанные мной контактные данные — телефон / Telegram / VK]`, с целью получения откликов по объявлению и связи с заинтересованными Пользователями.

Условия и запреты на распространение: контакты раскрываются только авторизованным Пользователям по их запросу и только по активным объявлениям; точный адрес не распространяется. Я могу в любой момент отозвать это согласие или изменить состав раскрываемых контактов в настройках профиля; отзыв прекращает дальнейшее распространение.»

- Scope: only the contact methods the Seller explicitly selects.
- Withdrawal: profile setting; takes effect for future reveals.

## Consent 2 — Marketing communications (ст.9 ФЗ-152 + ФЗ-38 ст.18)
«Я даю согласие на обработку моих персональных данных (`[e-mail, телефон, Telegram]`) в целях получения **рекламных и маркетинговых сообщений** Оператора (рассылки, уведомления об акциях) по выбранным каналам. Согласие добровольно и может быть отозвано в любой момент в настройках профиля или по ссылке «отписаться» в сообщении.»

> **Note:** ФЗ-38 «О рекламе» ст.18 requires **prior opt-in consent** for advertising distribution by electronic means; transactional/service messages (moderation result, security) are **not** advertising and run on the contract basis. Keep the two channels separate.

## Consent 3 — Analytics and profiling (ст.9 ФЗ-152)
«Я даю согласие на обработку моих персональных и пользовательских данных (поведение на Платформе, технические данные) в целях **аналитики, улучшения сервиса и формирования рекомендаций (профилирование)**. Согласие добровольно и может быть отозвано в настройках профиля; отзыв не влияет на работу базовых функций Платформы.»

## Consent 4 — Non-essential cookies (ст.9 ФЗ-152)
«Я согласен на использование **необязательных файлов cookie** (аналитических/маркетинговых). Обязательные (сессионные, защитные) cookie используются на основании договора и не требуют согласия.»

---

## Mapping to implementation
| Consent | Stored where | Linked feature |
|---|---|---|
| 1 — distribution of contacts | `users.contact_prefs` + consent log | contact-reveal (ADR-0005) |
| 2 — marketing | consent log + notification preference | marketing notifications (gated; ФЗ-38) |
| 3 — analytics/profiling | consent log | analytics events / recommendations |
| 4 — cookies | consent log / cookie banner | analytics & marketing cookies |

> The consent **log** (version + timestamp + action) is the Operator's proof under ст.9 ч.1; a withdrawal must be as easy as the grant (ст.9 ч.2). These map onto the granular-consent mechanism noted in `nfr/security.md` and `data-governance.md`.

---
🌐 RU mirror: `docsRU/legal/consent-personal-data.md` (legally operative text)
