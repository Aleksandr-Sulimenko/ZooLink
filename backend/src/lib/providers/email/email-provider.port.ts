/** Outbound transactional email (verification, moderation results). Vendor: Unisender (ADR-0008). */
export interface EmailMessage {
  to: string;
  subject: string;
  /** At least one of html/text should be set; html is preferred when both present. */
  html?: string;
  text?: string;
}

export interface EmailSendResult {
  accepted: boolean;
  providerMessageId: string | null;
}

export interface EmailProvider {
  sendEmail(msg: EmailMessage): Promise<EmailSendResult>;
}
