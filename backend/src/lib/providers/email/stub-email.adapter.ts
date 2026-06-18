import { Logger } from '@nestjs/common';
import { maskEmail } from '../pii.util';
import type { EmailMessage, EmailProvider, EmailSendResult } from './email-provider.port';

/** Dev/test email adapter used when Unisender is not fully configured. */
export class StubEmailProvider implements EmailProvider {
  private readonly logger = new Logger('StubEmailProvider');

  async sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
    this.logger.warn(`[STUB] Email to ${maskEmail(msg.to)} — "${msg.subject}"`);
    return Promise.resolve({ accepted: true, providerMessageId: null });
  }
}
