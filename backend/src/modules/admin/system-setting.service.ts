import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import { FeatureToggleService } from '../../lib/feature-toggle/feature-toggle.service';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal, PrincipalType } from '../../lib/auth/principal';
import type { SystemSetting, UpdateSystemSettingDto } from './dto/system-setting.dto';

/** A feature_toggles row as Prisma returns it (the storage backing system settings in the MVP). */
interface ToggleRow {
  key: string;
  description: string | null;
  is_enabled: boolean;
  rollout_percentage: number | null;
  updated_at: Date;
  updated_by: string | null;
}

/** The structured value carried in SystemSetting.value (JSON-encoded). */
interface ToggleValue {
  isEnabled: boolean;
  rolloutPercentage: number;
}

/**
 * System Settings admin endpoints (admin-api.yaml getSystemSettings / updateSystemSetting; spec
 * data-governance.md §6). In the MVP the **single source of truth is `feature_toggles`**
 * (data-governance.md §6), so a "system setting" is a feature toggle projected into the
 * SystemSetting {key, value, description, updatedAt, updatedBy} shape; the `value` is a JSON string
 * encoding the toggle state `{isEnabled, rolloutPercentage}`.
 *
 * The mutation is delegated to {@link FeatureToggleService.flip} — which performs the ADMIN-only
 * upsert atomically with an `audit_log` write and a deterministic-rollout invariant — so this service
 * does not reinvent the write path; it adds only the optimistic-concurrency (If-Match/ETag) guard and
 * the SystemSetting projection.
 *
 * CONTRACT GAP (flagged, not silently fixed): the business requirement (admin-domain.md §5) scopes
 * "system settings" to arbitrary parameters (rate limits, moderation params, search defaults,
 * integration keys, maintenance mode, thresholds), but the only storage that exists is
 * `feature_toggles` (no generic key→value table). The MVP therefore serves **feature toggles only**.
 */
@Injectable()
export class SystemSettingService {
  private readonly logger = new Logger(SystemSettingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toggles: FeatureToggleService,
  ) {}

  /**
   * GET /system/settings — all settings as a map keyed by setting key (admin-api.yaml: the response
   * is `additionalProperties: SystemSetting`, i.e. an object map, NOT a `{items, meta}` page).
   */
  async getAll(): Promise<Record<string, SystemSetting>> {
    const rows = (await this.prisma.feature_toggles.findMany({
      orderBy: { key: 'asc' },
    })) as ToggleRow[];
    const principalTypes = await this.resolvePrincipalTypes(rows);
    const out: Record<string, SystemSetting> = {};
    for (const row of rows) {
      out[row.key] = this.toSetting(row, principalTypes);
    }
    return out;
  }

  /** PATCH /system/settings/{key} — optimistic-concurrency update, delegated to FeatureToggleService.flip. */
  async update(
    key: string,
    dto: UpdateSystemSettingDto,
    ifMatch: string | undefined,
    actor: AuthPrincipal,
    ctx: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<{ setting: SystemSetting; etag: string }> {
    const existing = (await this.prisma.feature_toggles.findUnique({ where: { key } })) as ToggleRow | null;
    if (!existing) {
      throw new NotFoundException({ message: `Unknown system setting '${key}'`, code: 'NOT_FOUND' });
    }
    // Optimistic concurrency (API_CONVENTIONS §10): If-Match must carry the ETag from a prior read.
    assertIfMatch(ifMatch, this.etag(existing));

    const parsed = this.parseValue(dto.value);
    await this.toggles.flip(
      key,
      {
        isEnabled: parsed.isEnabled,
        rolloutPercentage: parsed.rolloutPercentage,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      actor,
      ctx,
    );

    const updated = (await this.prisma.feature_toggles.findUnique({ where: { key } })) as ToggleRow;
    const principalTypes = await this.resolvePrincipalTypes([updated]);
    this.logger.log(`System setting '${key}' updated by ${actor.userId}`);
    return { setting: this.toSetting(updated, principalTypes), etag: this.etag(updated) };
  }

  /** Weak ETag for a setting (API_CONVENTIONS §10) — derived from key + updated_at. */
  private etag(row: ToggleRow): string {
    return weakEtag(`system-setting:${row.key}`, row.updated_at);
  }

  /**
   * Parse the SystemSettingUpdateRequest.value string. Accepts a JSON object
   * `{"isEnabled": bool, "rolloutPercentage": int}` (the toggle-state encoding) — partials allowed
   * (omitted fields fall back to a safe default). 400 VALIDATION_ERROR on malformed input.
   */
  private parseValue(value: string): ToggleValue {
    let raw: unknown;
    try {
      raw = JSON.parse(value);
    } catch {
      throw new BadRequestException({
        message: 'value must be a JSON string, e.g. {"isEnabled":true,"rolloutPercentage":100}',
        code: 'VALIDATION_ERROR',
      });
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BadRequestException({ message: 'value must encode a JSON object', code: 'VALIDATION_ERROR' });
    }
    const obj = raw as Record<string, unknown>;
    const isEnabled = obj.isEnabled;
    const rolloutPercentage = obj.rolloutPercentage ?? 0;
    if (typeof isEnabled !== 'boolean') {
      throw new BadRequestException({ message: 'value.isEnabled must be a boolean', code: 'VALIDATION_ERROR' });
    }
    if (
      typeof rolloutPercentage !== 'number' ||
      !Number.isInteger(rolloutPercentage) ||
      rolloutPercentage < 0 ||
      rolloutPercentage > 100
    ) {
      throw new BadRequestException({
        message: 'value.rolloutPercentage must be an integer 0..100',
        code: 'VALIDATION_ERROR',
      });
    }
    return { isEnabled, rolloutPercentage };
  }

  /** Project a feature_toggles row into the SystemSetting wire shape. */
  private toSetting(row: ToggleRow, principalTypes: Map<string, PrincipalType>): SystemSetting {
    const value: ToggleValue = {
      isEnabled: row.is_enabled,
      rolloutPercentage: row.rollout_percentage ?? 0,
    };
    return {
      key: row.key,
      value: JSON.stringify(value),
      description: row.description,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
        ? {
            actorId: row.updated_by,
            // best-effort: feature_toggles has no principal_type snapshot column, so resolve the
            // referenced user's CURRENT principal_type (flagged — not an as-of-action snapshot).
            principalType: principalTypes.get(row.updated_by) ?? 'HUMAN',
            actorDisplayName: null,
          }
        : null,
    };
  }

  /** Batch-resolve the current principal_type of the updaters (single query, no N+1). */
  private async resolvePrincipalTypes(rows: ToggleRow[]): Promise<Map<string, PrincipalType>> {
    const ids = [...new Set(rows.map((r) => r.updated_by).filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, principal_type: true },
    });
    return new Map(users.map((u) => [u.id, u.principal_type as PrincipalType]));
  }
}
