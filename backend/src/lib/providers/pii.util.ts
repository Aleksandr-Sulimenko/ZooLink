/**
 * Masking helpers for adapter logs. Per data-governance.md, recipient identifiers
 * (phone, email) are PII and must never appear in plaintext in logs — including the
 * stub adapters that log every send during development.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}
