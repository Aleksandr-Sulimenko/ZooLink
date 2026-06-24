import { Logger } from '@nestjs/common';
import { fetchJson } from '../http.util';
import { ProviderError } from '../provider-error';
import { maskEmail } from '../pii.util';
import type { EmailMessage, EmailProvider, EmailSendResult } from './email-provider.port';

interface UnisenderResponse {
  result?: { id?: string | number; index?: number };
  error?: string;
  code?: string;
}

const ENDPOINT = 'https://api.unisender.com/ru/api/sendEmail';

export interface UnisenderConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  listId: string;
}

/**
 * Unisender transactional email adapter (ADR-0008 default). `sendEmail` requires a
 * verified sender and a list id (Unisender attaches an unsubscribe footer). Body is
 * sent form-encoded per the vendor API.
 */
export class UnisenderAdapter implements EmailProvider {
  private readonly logger = new Logger(UnisenderAdapter.name);

  constructor(private readonly cfg: UnisenderConfig) {}

  async sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
    const form = new URLSearchParams({
      format: 'json',
      api_key: this.cfg.apiKey,
      email: msg.to,
      sender_name: this.cfg.fromName,
      sender_email: this.cfg.fromEmail,
      subject: msg.subject,
      body: msg.html ?? msg.text ?? '',
      list_id: this.cfg.listId,
    });

    const data = await fetchJson<UnisenderResponse>('unisender', ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (data.error) {
      throw new ProviderError('unisender', 'response', `send rejected (${data.code ?? 'error'}): ${data.error}`);
    }

    const id = data.result?.id != null ? String(data.result.id) : null;
    this.logger.log(`Email sent to ${maskEmail(msg.to)} (id=${id ?? 'n/a'})`);
    return { accepted: true, providerMessageId: id };
  }
}
