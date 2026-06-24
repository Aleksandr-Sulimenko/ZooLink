/** Outbound transactional SMS (verification codes). Vendor: SMS.RU (ADR-0008). */
export interface SmsMessage {
  /** E.164 phone, e.g. `+79991234567`. */
  to: string;
  text: string;
}

export interface SmsSendResult {
  accepted: boolean;
  /** Vendor message id when available (null for stub / not returned). */
  providerMessageId: string | null;
}

export interface SmsProvider {
  sendSms(msg: SmsMessage): Promise<SmsSendResult>;
}
