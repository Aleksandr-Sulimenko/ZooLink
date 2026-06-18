import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../../config/config.module';
import { ProvidersModule } from './providers.module';
import {
  EMAIL_PROVIDER,
  MAPS_PROVIDER,
  OBJECT_STORAGE,
  PAYMENT_PROVIDER,
  SMS_PROVIDER,
} from './provider.tokens';
import { StubSmsProvider } from './sms/stub-sms.adapter';
import { StubEmailProvider } from './email/stub-email.adapter';
import { StubMapsProvider } from './maps/stub-maps.adapter';
import { S3ObjectStorage } from './storage/s3.adapter';
import { StubPaymentProvider } from './payment/stub-payment.adapter';

/**
 * With the dev/test env (no provider credentials), comms adapters fall back to stubs while
 * object storage stays live (S3 connectivity is a required env). Payments are always stubbed
 * in the MVP.
 */
describe('ProvidersModule (default env selection)', () => {
  it('resolves stubs for SMS/email/maps, live S3 storage, and stub payments', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, ProvidersModule],
    }).compile();

    expect(moduleRef.get(SMS_PROVIDER)).toBeInstanceOf(StubSmsProvider);
    expect(moduleRef.get(EMAIL_PROVIDER)).toBeInstanceOf(StubEmailProvider);
    expect(moduleRef.get(MAPS_PROVIDER)).toBeInstanceOf(StubMapsProvider);
    expect(moduleRef.get(OBJECT_STORAGE)).toBeInstanceOf(S3ObjectStorage);

    const payment = moduleRef.get<StubPaymentProvider>(PAYMENT_PROVIDER);
    expect(payment).toBeInstanceOf(StubPaymentProvider);
    expect(payment.available).toBe(false);
    await expect(
      payment.createPayment({
        amountMinor: 1000,
        currency: 'RUB',
        description: 'x',
        idempotencyKey: 'k',
        returnUrl: 'https://zoolink.ru/return',
      }),
    ).rejects.toThrow(/payments are disabled/);

    await moduleRef.close();
  });
});
