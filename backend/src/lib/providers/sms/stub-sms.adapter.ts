import { Logger } from '@nestjs/common';
import { maskPhone } from '../pii.util';
import type { SmsMessage, SmsProvider, SmsSendResult } from './sms-provider.port';

/**
 * Dev/test SMS adapter used when no SMS.RU credential is configured. Logs the (masked)
 * recipient and "sends" nothing, so flows like phone verification work offline.
 */
export class StubSmsProvider implements SmsProvider {
  private readonly logger = new Logger('StubSmsProvider');

  async sendSms(msg: SmsMessage): Promise<SmsSendResult> {
    this.logger.warn(`[STUB] SMS to ${maskPhone(msg.to)}: ${msg.text}`);
    return Promise.resolve({ accepted: true, providerMessageId: null });
  }
}
