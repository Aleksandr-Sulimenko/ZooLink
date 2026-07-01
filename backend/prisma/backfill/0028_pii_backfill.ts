/**
 * ADR-0019 companion backfill for migration 20260701_0028 — encrypt existing plaintext PII and
 * populate the email blind index. Run ONCE after applying the 0028 DDL (before relying on the
 * recovery/admin-search lookups on existing accounts):
 *
 *   cd backend && npx ts-node prisma/backfill/0028_pii_backfill.ts
 *
 * Idempotent: a row whose email is already `enc:v1:`-prefixed is not re-encrypted; email_bidx is
 * (re)derived from the decrypted plaintext, so re-running yields the identical value. Safe to run twice.
 * Reads PII_DATA_KEY / PII_BLIND_INDEX_KEY from the env (backend/.env), exactly like the app.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../../src/lib/crypto/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';

loadEnv({ path: join(__dirname, '..', '..', '.env'), quiet: true });

// Minimal config shim: CryptoService only reads PII_DATA_KEY / PII_BLIND_INDEX_KEY.
const configShim = {
  get: (key: string) => {
    const v = process.env[key];
    if (!v) throw new Error(`Missing env ${key} — cannot backfill PII`);
    return v;
  },
} as unknown as AppConfigService;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const crypto = new CryptoService(configShim);
  let emails = 0;
  let phones = 0;

  try {
    const rows = await prisma.users.findMany({
      where: { OR: [{ email: { not: null } }, { contact_phone: { not: null } }] },
      select: { id: true, email: true, email_bidx: true, contact_phone: true },
    });

    for (const row of rows) {
      const data: Record<string, string | null> = {};

      if (row.email !== null) {
        const plainEmail = crypto.decrypt(row.email); // works whether ciphertext or legacy plaintext
        const cipherEmail = crypto.isEncrypted(row.email) ? row.email : crypto.encrypt(plainEmail);
        const bidx = plainEmail ? crypto.emailBlindIndex(plainEmail) : null;
        if (cipherEmail !== row.email || bidx !== row.email_bidx) {
          data.email = cipherEmail;
          data.email_bidx = bidx;
          emails += 1;
        }
      }

      if (row.contact_phone !== null && !crypto.isEncrypted(row.contact_phone)) {
        data.contact_phone = crypto.encrypt(row.contact_phone);
        phones += 1;
      }

      if (Object.keys(data).length > 0) {
        await prisma.users.update({ where: { id: row.id }, data });
      }
    }

    console.log(`Backfill 0028 done: ${emails} email(s) encrypted/indexed, ${phones} contact_phone(s) encrypted.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
