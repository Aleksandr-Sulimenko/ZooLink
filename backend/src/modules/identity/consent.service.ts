import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';

/** Consent kinds (ADR-0020). Only CONTACT_DISTRIBUTION is wired to behaviour in MVP; the rest are reserved. */
export type ConsentType =
  | 'CONTACT_DISTRIBUTION'
  | 'MARKETING'
  | 'ANALYTICS_PROFILING'
  | 'NONESSENTIAL_COOKIES';

/**
 * Version of the consent text the subject agrees to (proof under ст.9 ч.1 ФЗ-152). Tied to
 * `docs/legal/consent-personal-data.md`; a plain string (no policy-registry FK in MVP — ADR-0020 Consequences).
 * Bump this constant when the consent text changes so a later grant is recorded against the new version.
 */
export const CONSENT_POLICY_VERSION = '1.0';

export interface RecordConsentInput {
  userId: string; // the DATA SUBJECT
  type: ConsentType;
  granted: boolean; // true = grant, false = withdrawal (a new superseding row)
  source: string; // origin of the affirmative action ('PROFILE_SETTINGS', 'REGISTRATION', 'ADMIN', 'AGENT')
  actorId: string; // WHO recorded it (normally == userId; differs for operator/AGENT on-behalf)
  actorPrincipalType?: 'HUMAN' | 'AGENT';
  policyVersion?: string;
}

/**
 * Append-only, versioned consent log (ADR-0020, ADR-0011 supersede shape). A change is ALWAYS a new row —
 * never an UPDATE (the DB enforces immutability via trg_consents_immutable). The current consent for a
 * (subject, kind) is the latest row by `created_at`; there is no mutable boolean mirroring it. This is the
 * statutory proof store (ст.9 ч.1: text version + timestamp + action; ст.9 ч.2: withdrawal = a granted=false row).
 *
 * Subject (`userId`) is always kept distinct from the acting principal (`actorId`) so an operator/AGENT
 * recording a consent on a subject's behalf (ADR-0006) is representable and auditable (`actorPrincipalType`).
 */
@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Append a consent row (grant or withdrawal). Pass `tx` to write it in the caller's transaction. */
  async record(input: RecordConsentInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.consents.create({
      data: {
        user_id: input.userId,
        consent_type: input.type,
        granted: input.granted,
        policy_version: input.policyVersion ?? CONSENT_POLICY_VERSION,
        source: input.source,
        actor_id: input.actorId,
        actor_principal_type: input.actorPrincipalType ?? 'HUMAN',
      },
    });
  }

  /**
   * Current consent = the latest row by `(user_id, consent_type)` (idx_consents_current). No row at all →
   * default-deny (`false`) — the ст.10.1 default is no-consent. Pass `tx` to read your own uncommitted write.
   */
  async currentlyGranted(userId: string, type: ConsentType, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx ?? this.prisma;
    const latest = await client.consents.findFirst({
      where: { user_id: userId, consent_type: type },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { granted: true },
    });
    return latest?.granted ?? false;
  }
}
