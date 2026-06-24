import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthPrincipal } from '../auth/principal';
import { isInRollout } from './rollout';

export interface ToggleState {
  isEnabled: boolean;
  rolloutPercentage: number;
}

export interface FlipInput {
  isEnabled?: boolean;
  rolloutPercentage?: number;
  description?: string;
}

export interface FlipContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const CACHE_TTL_MS = 30_000;

/**
 * Reads and flips `feature_toggles` (e.g. the `payments` gate, ADR-0008). Evaluation is a
 * deterministic percentage rollout; flips are ADMIN-only and append to `audit_log` atomically
 * with the change. A short read-through cache avoids a DB hit per request — cross-instance
 * flip propagation is therefore bounded by {@link CACHE_TTL_MS}.
 */
@Injectable()
export class FeatureToggleService {
  private readonly logger = new Logger(FeatureToggleService.name);
  private readonly cache = new Map<string, { state: ToggleState | null; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * True when the toggle is on and the subject is inside the rollout. A partial rollout
   * (0 < pct < 100) requires a `subjectId`; anonymous/system callers only see fully-on
   * toggles, so a half-rolled-out feature never leaks to un-identified traffic.
   */
  async isEnabled(key: string, subjectId?: string): Promise<boolean> {
    const state = await this.read(key);
    if (!state || !state.isEnabled) return false;
    if (state.rolloutPercentage >= 100) return true;
    if (!subjectId) return false;
    return isInRollout(key, subjectId, state.rolloutPercentage);
  }

  /** Raw state (uncached miss → null) for admin reads. */
  async getState(key: string): Promise<ToggleState | null> {
    return this.read(key);
  }

  async flip(
    key: string,
    input: FlipInput,
    actor: AuthPrincipal,
    ctx: FlipContext = {},
  ): Promise<ToggleState> {
    // Defence-in-depth: routes must also be guarded by RolesGuard(['ADMIN']).
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('feature-toggle flip requires ADMIN');
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const before = await tx.feature_toggles.findUnique({ where: { key } });
      const updated = await tx.feature_toggles.upsert({
        where: { key },
        create: {
          key,
          description: input.description ?? null,
          is_enabled: input.isEnabled ?? false,
          rollout_percentage: input.rolloutPercentage ?? 0,
          updated_by: actor.userId,
        },
        update: {
          ...(input.isEnabled !== undefined ? { is_enabled: input.isEnabled } : {}),
          ...(input.rolloutPercentage !== undefined
            ? { rollout_percentage: input.rolloutPercentage }
            : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updated_by: actor.userId,
        },
      });

      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: actor.role,
          action: 'feature_toggle.flip',
          entityType: 'feature_toggle',
          entityId: null, // toggle key is a VARCHAR, not a UUID; key lives in before/after data
          beforeData: before
            ? {
                key,
                is_enabled: before.is_enabled,
                rollout_percentage: before.rollout_percentage,
              }
            : null,
          afterData: {
            key,
            is_enabled: updated.is_enabled,
            rollout_percentage: updated.rollout_percentage,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return updated;
    });

    this.cache.delete(key);
    this.logger.log(
      `Toggle "${key}" flipped by ${actor.userId} → enabled=${after.is_enabled} rollout=${after.rollout_percentage ?? 0}%`,
    );
    return { isEnabled: after.is_enabled, rolloutPercentage: after.rollout_percentage ?? 0 };
  }

  private async read(key: string): Promise<ToggleState | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.state;

    const row = await this.prisma.feature_toggles.findUnique({ where: { key } });
    const state: ToggleState | null = row
      ? { isEnabled: row.is_enabled, rolloutPercentage: row.rollout_percentage ?? 0 }
      : null;
    this.cache.set(key, { state, at: Date.now() });
    return state;
  }
}
