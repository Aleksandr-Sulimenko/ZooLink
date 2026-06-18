import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../lib/db/prisma.service';
import { AppConfigService } from '../../config/app-config.service';

const MAX_ACTIVE_FAMILIES = 5; // spec 01 round-4: max 5 active families/user (oldest evicted)
const REFRESH_BYTES = 32;

export interface RotatedRefresh {
  token: string;
  userId: string;
  familyId: string;
}

/**
 * DB-backed refresh tokens with family rotation + reuse detection (spec 01, round-4 normative).
 * The opaque token is never stored — only its SHA-256 hash (`refresh_tokens.token_hash`).
 * On rotation the presented row is revoked and a new row is created in the same family
 * (`rotated_from`). Presenting an already-revoked/rotated token = **theft** → the whole family
 * is revoked.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.ttlMs = parseDurationMs(config.get('JWT_REFRESH_TTL'));
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private newToken(): string {
    return randomBytes(REFRESH_BYTES).toString('base64url');
  }

  /** Issues a brand-new family (login/registration). Evicts the oldest family past the cap. */
  async issue(userId: string, deviceLabel?: string): Promise<RotatedRefresh> {
    await this.evictOldestIfOverCap(userId);
    const token = this.newToken();
    const familyId = randomUUID();
    await this.prisma.refresh_tokens.create({
      data: {
        user_id: userId,
        token_hash: this.hash(token),
        family_id: familyId,
        device_label: deviceLabel,
        expires_at: new Date(Date.now() + this.ttlMs),
      },
    });
    return { token, userId, familyId };
  }

  /** Rotates a presented refresh token; revokes the whole family on reuse. */
  async rotate(presented: string): Promise<RotatedRefresh> {
    const row = await this.prisma.refresh_tokens.findUnique({
      where: { token_hash: this.hash(presented) },
    });
    if (!row) {
      throw new UnauthorizedException({ message: 'Invalid refresh token', code: 'UNAUTHENTICATED' });
    }
    if (row.revoked_at) {
      // The token was already used (rotated) or revoked → reuse/theft. Burn the family.
      await this.revokeFamily(row.family_id);
      this.logger.warn(`Refresh token reuse detected; revoked family ${row.family_id}`);
      throw new UnauthorizedException({ message: 'Refresh token reuse detected', code: 'UNAUTHENTICATED' });
    }
    if (row.expires_at <= new Date()) {
      throw new UnauthorizedException({ message: 'Refresh token expired', code: 'UNAUTHENTICATED' });
    }

    const token = this.newToken();
    await this.prisma.$transaction([
      this.prisma.refresh_tokens.update({ where: { id: row.id }, data: { revoked_at: new Date() } }),
      this.prisma.refresh_tokens.create({
        data: {
          user_id: row.user_id,
          token_hash: this.hash(token),
          family_id: row.family_id,
          device_label: row.device_label,
          rotated_from: row.id,
          expires_at: new Date(Date.now() + this.ttlMs),
        },
      }),
    ]);
    return { token, userId: row.user_id, familyId: row.family_id };
  }

  /** Revokes the family that owns the presented token (single-device logout). */
  async revokeByToken(presented: string): Promise<void> {
    const row = await this.prisma.refresh_tokens.findUnique({
      where: { token_hash: this.hash(presented) },
      select: { family_id: true },
    });
    if (row) await this.revokeFamily(row.family_id);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  /** Revoke every active session for a user (password/role/status change, logout-all). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  private async evictOldestIfOverCap(userId: string): Promise<void> {
    const families = await this.prisma.refresh_tokens.findMany({
      where: { user_id: userId, revoked_at: null },
      distinct: ['family_id'],
      select: { family_id: true },
      orderBy: { issued_at: 'asc' },
    });
    const overBy = families.length - (MAX_ACTIVE_FAMILIES - 1);
    for (let i = 0; i < overBy; i++) {
      await this.revokeFamily(families[i].family_id);
    }
  }
}

/** Parses a short duration string like "7d" / "15m" / "30s" / "12h" into milliseconds. */
export function parseDurationMs(value: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!m) throw new Error(`Invalid duration: ${value}`);
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]!;
  return n * unit;
}
