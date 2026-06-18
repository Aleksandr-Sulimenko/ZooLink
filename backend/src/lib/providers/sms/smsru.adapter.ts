import { Logger } from '@nestjs/common';
import { fetchJson } from '../http.util';
import { ProviderError } from '../provider-error';
import { maskPhone } from '../pii.util';
import type { SmsMessage, SmsProvider, SmsSendResult } from './sms-provider.port';

/** Shape of the SMS.RU `/sms/send?json=1` response we rely on. */
interface SmsRuResponse {
  status: string;
  status_code: number;
  status_text?: string;
  sms?: Record<string, { status: string; status_code: number; sms_id?: string }>;
}

const ENDPOINT = 'https://sms.ru/sms/send';

/** SMS.RU adapter (ADR-0008 default). Auth via `api_id`; HTTPS GET with JSON output. */
export class SmsRuAdapter implements SmsProvider {
  private readonly logger = new Logger(SmsRuAdapter.name);

  constructor(
    private readonly apiId: string,
    private readonly from: string,
  ) {}

  async sendSms(msg: SmsMessage): Promise<SmsSendResult> {
    // SECURITY: SMS.RU authenticates via api_id in the query string (vendor-mandated). The
    // request URL therefore contains a secret — never log the URL (fetchJson logs only the
    // response body on failure, and ProviderError carries no URL).
    const params = new URLSearchParams({
      api_id: this.apiId,
      to: msg.to,
      msg: msg.text,
      json: '1',
    });
    if (this.from) params.set('from', this.from);

    const data = await fetchJson<SmsRuResponse>('smsru', `${ENDPOINT}?${params.toString()}`);
    if (data.status !== 'OK') {
      throw new ProviderError(
        'smsru',
        'response',
        `send rejected (status_code=${data.status_code}): ${data.status_text ?? ''}`,
      );
    }

    const entry = data.sms ? Object.values(data.sms)[0] : undefined;
    const accepted = entry?.status === 'OK';
    this.logger.log(`SMS sent to ${maskPhone(msg.to)} (accepted=${accepted})`);
    return { accepted, providerMessageId: entry?.sms_id ?? null };
  }
}
