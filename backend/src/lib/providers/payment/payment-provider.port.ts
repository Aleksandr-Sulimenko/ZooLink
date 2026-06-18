/**
 * Acquiring/payments port. Vendor default ЮKassa + СБП (ADR-0008), Фаза 2+.
 * The interface is defined now so the Payment domain can be written against it, but the
 * MVP wires a stub: payments stay gated behind `feature_toggles.payments` (off).
 */
export interface CreatePaymentInput {
  /** Integer minor units (kopecks). See API_CONVENTIONS.md — money is never a float. */
  amountMinor: number;
  currency: 'RUB';
  description: string;
  /** Caller-supplied idempotency key (also forwarded to the vendor). */
  idempotencyKey: string;
  /** Where the user returns after the hosted payment page. */
  returnUrl: string;
}

export interface PaymentIntent {
  providerPaymentId: string;
  /** Hosted confirmation URL to redirect the payer to. */
  confirmationUrl: string;
  status: string;
}

export interface PaymentProvider {
  /** False while payments are disabled (MVP). Callers must check before creating. */
  readonly available: boolean;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
}
