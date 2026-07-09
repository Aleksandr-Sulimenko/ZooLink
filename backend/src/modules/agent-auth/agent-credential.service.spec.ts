import { ForbiddenException } from '@nestjs/common';
import { AgentCredentialService } from './agent-credential.service';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { RedisService } from '../../lib/redis/redis.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { CryptoService } from '../../lib/crypto/crypto.service';
import type { FeatureToggleService } from '../../lib/feature-toggle/feature-toggle.service';
import type { TokenService } from '../auth/token.service';
import type { CapabilityProfileService } from './capability-profile.service';

/**
 * ADR-0036 §2 — issuance is a HUMAN-only capability. RolesGuard is principal-agnostic (ADR-0011 §7),
 * so an AGENT holding role='ADMIN' would pass the coarse route gate; the service-layer `assertHumanActor`
 * is the structural close of the rejected "agent-issues-agent" anti-pattern. It runs FIRST, so these
 * assertions need no DB — the guard throws before any Prisma access.
 */
function makeService(): AgentCredentialService {
  const noop = jest.fn();
  return new AgentCredentialService(
    { service_credentials: { findUnique: noop, create: noop, update: noop } } as unknown as PrismaService,
    {} as unknown as RedisService,
    { record: noop } as unknown as AuditLogService,
    {} as unknown as CryptoService,
    {} as unknown as FeatureToggleService,
    {} as unknown as TokenService,
    {} as unknown as CapabilityProfileService,
  );
}

const agentAdmin: AuthPrincipal = { userId: 'agent-1', role: 'ADMIN', principalType: 'AGENT' };

describe('AgentCredentialService — issuance is HUMAN-only (ADR-0036 §2)', () => {
  const svc = makeService();

  it('issue() rejects an AGENT principal (even role=ADMIN) with 403', async () => {
    await expect(svc.issue(agentAdmin, 'target-agent', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotate() rejects an AGENT principal (even role=ADMIN) with 403', async () => {
    await expect(svc.rotate(agentAdmin, 'cred-1', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revoke() rejects an AGENT principal (even role=ADMIN) with 403', async () => {
    await expect(svc.revoke(agentAdmin, 'cred-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('carries the stable ISSUANCE_HUMAN_ONLY code', async () => {
    await svc.issue(agentAdmin, 'target-agent', {}).catch((e: ForbiddenException) => {
      expect((e.getResponse() as { code: string }).code).toBe('ISSUANCE_HUMAN_ONLY');
    });
    expect.assertions(1);
  });
});
