import { Injectable, Logger } from '@nestjs/common';
import { type users } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuditLogService } from '../audit/audit-log.service';

/**
 * Default notification prefs (mirror of the DB column default — used on erase reset).
 * Kept in sync with AdminUserService (modules/identity/admin-user.service.ts) — same canonical
 * `erase_user` field actions (data-governance.md §1 / spec 01 Slice-4). If one changes, change both.
 */
const DEFAULT_NOTIFICATION_PREFS = { email: true, sms: true, promo: false };
/** Default contact-visibility prefs (mirror of the DB column default — used on erase reset; ADR-0005). */
const DEFAULT_CONTACT_PREFS = { show_phone: true, show_telegram: false };

/**
 * D2 retention behaviour (ADMIN_PHASE_ACTION_PLAN.md), executed by RetentionExpireJob under the B7
 * advisory lock. This service holds the *behaviour*; the job holds the *scheduling*. It depends only
 * on worker-available primitives (PrismaService + AuditLogService) so it can live in WorkerModule
 * without pulling in the HTTP-coupled identity/auth module graph.
 *
 * Two idempotent passes (a repeated tick is always safe):
 *   (a) Auto-expire listings: ACTIVE listings whose `expires_at` has passed → EXPIRED (GAP-012).
 *   (b) Erase-after-grace: DEACTIVATED accounts past the grace window (and not yet erased) → erase_user
 *       (spec 01 "MVP has no scheduler" open item; data-governance.md §2).
 *
 * The actor for retention work is the *system* (actorId = null, principal_type defaults HUMAN — this
 * is platform automation, not an AI-agent decision). Audit rows are written so an operator can see it ran.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditLogService,
  ) {}

  /** Run both retention passes. Returns counts for observability/tests. */
  async runOnce(): Promise<{ expiredListings: number; erasedAccounts: number }> {
    const expiredListings = await this.expireListings();
    const erasedAccounts = await this.eraseDeactivatedPastGrace();
    return { expiredListings, erasedAccounts };
  }

  /**
   * (a) Auto-expire listings (GAP-012). ACTIVE listings with a past `expires_at` → EXPIRED.
   *
   * Parameterized raw SQL (one set-based UPDATE; ESLint forbids string interpolation). The listings
   * approval-gate trigger only restricts transitions *into* ACTIVE, so ACTIVE→EXPIRED is allowed.
   * Idempotent: the `status='ACTIVE'` predicate means a re-run skips rows already moved to EXPIRED.
   * Dormant until the Listings domain sets `expires_at` — form + behaviour are ready ahead of it.
   */
  async expireListings(): Promise<number> {
    const updated = await this.prisma.$executeRaw`
      UPDATE listings
         SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'ACTIVE'
         AND expires_at IS NOT NULL
         AND expires_at < now()
    `;
    if (updated > 0) {
      this.logger.log(`Auto-expired ${updated} listing(s) past expires_at`);
      await this.audit.record({
        actorId: null, // system automation — no user actor
        actorRole: 'SYSTEM',
        action: 'listing.auto_expired',
        entityType: 'listing',
        afterData: { count: updated },
      });
    }
    return updated;
  }

  /**
   * (b) Erase-after-grace (spec 01 / data-governance.md §2). DEACTIVATED accounts whose
   * `deactivated_at` is older than the grace window and not yet erased → run erase_user.
   *
   * Idempotent: `erased_at IS NULL` predicate + the per-user guard skip already-erased rows.
   * Within-grace accounts (deactivated_at >= cutoff) are NOT selected — they remain recoverable.
   */
  async eraseDeactivatedPastGrace(): Promise<number> {
    const graceDays = this.config.get('RETENTION_GRACE_DAYS');
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.users.findMany({
      where: {
        status: 'DEACTIVATED',
        erased_at: null,
        deactivated_at: { not: null, lt: cutoff },
      },
    });

    let erased = 0;
    for (const user of candidates) {
      await this.eraseUser(user);
      erased += 1;
    }
    if (erased > 0) {
      this.logger.log(`Erased ${erased} account(s) past the ${graceDays}-day deactivation grace`);
    }
    return erased;
  }

  /**
   * The `erase_user` procedure (data-governance.md §2): anonymise-in-place, keep the UUID.
   * Mirrors AdminUserService.eraseUser exactly (single canonical field-action set), but with the
   * system as actor and an inline session revoke (no AuthService dependency in the worker).
   * Idempotent — a no-op if already erased.
   */
  private async eraseUser(user: users): Promise<void> {
    if (user.erased_at) return; // already anonymised (idempotent)

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: user.id },
        data: {
          phone_hash: null,
          oauth_google_id: null,
          oauth_apple_id: null,
          oauth_telegram_id: null,
          oauth_vk_id: null,
          email: null,
          email_verified: false,
          full_name: '[deleted]', // column is NOT NULL → tombstone (spec 01 Slice-4)
          avatar_url: null,
          contact_phone: null,
          contact_telegram: null,
          contact_prefs: DEFAULT_CONTACT_PREFS,
          last_login_at: null,
          notification_prefs: DEFAULT_NOTIFICATION_PREFS,
          status: 'DEACTIVATED',
          is_active: false,
          deactivated_at: user.deactivated_at ?? now,
          erased_at: now,
        },
      });
      await tx.notification_logs.updateMany({
        where: { user_id: user.id },
        data: { recipient: '[erased]', content: null },
      });
      // Revoke all sessions (inline — same effect as AuthService.logout → revokeAllForUser).
      await tx.refresh_tokens.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: now, revoked_reason: 'ERASED' },
      });
    });

    await this.audit.record({
      actorId: null, // system/retention — no user actor
      actorRole: 'SYSTEM',
      action: 'user.erased',
      entityType: 'user',
      entityId: user.id,
      afterData: { trigger: 'retention_job', graceExpired: true },
    });
    this.logger.log(`User erased (anonymised) ${user.id} by retention job`);
  }
}
