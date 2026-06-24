/**
 * DI tokens for the external-provider ports (ADR-0008). Interfaces have no runtime
 * representation, so each capability is injected by an explicit symbol token:
 *   `constructor(@Inject(SMS_PROVIDER) private readonly sms: SmsProvider) {}`
 * Adapters are selected per environment in `providers.module.ts`.
 */
export const SMS_PROVIDER = Symbol('SmsProvider');
export const EMAIL_PROVIDER = Symbol('EmailProvider');
export const MAPS_PROVIDER = Symbol('MapsProvider');
export const OBJECT_STORAGE = Symbol('ObjectStorage');
export const PAYMENT_PROVIDER = Symbol('PaymentProvider');
