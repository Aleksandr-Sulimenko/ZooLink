import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgentCredentialService } from './agent-credential.service';
import { CapabilityProfileService } from './capability-profile.service';
import { AdminAgentCredentialController } from './admin-agent-credential.controller';
import { AgentTokenController } from './agent-token.controller';

/**
 * Agent-auth domain (ADR-0036 issuance + ADR-0037 scoped-ability). Wires:
 *  - the HUMAN-ADMIN credential-issuance endpoints (`/v1/admin/agents/{agentUserId}/credentials` …),
 *  - the machine credential→token exchange (`POST /v1/auth/agent/token`).
 * Builds on the platform foundation: PrismaService (@Global DbModule), RedisService (rate-limit),
 * AuditLogService + CryptoService + FeatureToggleService (@Global), and AuthModule's TokenService
 * (signs the AGENT JWT) + guards. Behaviour is gated by `feature_toggles.agent_service_auth` (off in MVP).
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminAgentCredentialController, AgentTokenController],
  providers: [AgentCredentialService, CapabilityProfileService],
})
export class AgentAuthModule {}
