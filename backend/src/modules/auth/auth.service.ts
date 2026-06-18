import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import type { AuthPrincipal, PrincipalType, Role } from '../../lib/auth/principal';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const BLOCKED_STATUSES = new Set(['SUSPENDED', 'DEACTIVATED']);

/**
 * Auth-core orchestration: issue a session (access JWT + opaque refresh), rotate on refresh,
 * and revoke on logout. Login/registration that PRODUCE a principal live in the Identity domain
 * (Phase 2) and call `issueSession` here.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async issueSession(principal: AuthPrincipal, deviceLabel?: string): Promise<TokenPair> {
    const refresh = await this.refreshTokens.issue(principal.userId, deviceLabel);
    return { accessToken: this.tokens.signAccess(principal), refreshToken: refresh.token };
  }

  /** Rotate a refresh token and mint a fresh access token, re-checking the account is usable. */
  async refresh(presentedRefresh: string): Promise<TokenPair> {
    const rotated = await this.refreshTokens.rotate(presentedRefresh);
    const user = await this.prisma.users.findUnique({ where: { id: rotated.userId } });
    if (!user || !user.is_active || BLOCKED_STATUSES.has(user.status)) {
      await this.refreshTokens.revokeFamily(rotated.familyId);
      throw new UnauthorizedException({ message: 'Account is not active', code: 'UNAUTHENTICATED' });
    }
    const principal: AuthPrincipal = {
      userId: user.id,
      role: user.role as Role,
      principalType: user.principal_type as PrincipalType,
    };
    return { accessToken: this.tokens.signAccess(principal), refreshToken: rotated.token };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.refreshTokens.revokeByToken(refreshToken);
    } else {
      await this.refreshTokens.revokeAllForUser(userId);
    }
  }
}
