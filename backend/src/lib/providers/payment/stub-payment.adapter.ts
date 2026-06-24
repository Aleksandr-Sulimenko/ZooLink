import { ProviderError } from '../provider-error';
import type {
  CreatePaymentInput,
  PaymentIntent,
  PaymentProvider,
} from './payment-provider.port';

/**
 * MVP payment provider: always unavailable. Payments are a Фаза 2+ capability gated by
 * `feature_toggles.payments` (ADR-0008). The real ЮKassa adapter (with 54-ФЗ fiscal
 * receipts) is implemented when that toggle is turned on. Any attempt to create a payment
 * now fails loudly so a leaked code path is caught in tests rather than silently.
 */
export class StubPaymentProvider implements PaymentProvider {
  readonly available = false;

  createPayment(_input: CreatePaymentInput): Promise<PaymentIntent> {
    return Promise.reject(
      new ProviderError(
        'payment',
        'config',
        'payments are disabled in MVP (feature_toggles.payments=off, ADR-0008)',
      ),
    );
  }
}
