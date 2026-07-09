import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import { IdempotencyInterceptor } from '../../lib/http/idempotency.interceptor';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { AgentCredentialService } from './agent-credential.service';
import {
  IssueCredentialDto,
  RotateCredentialDto,
  type CredentialIssuedView,
} from './dto/agent-auth.dto';

/**
 * ADR-0036 §2 — human-ADMIN issuance of agent service-credentials. Every action is ADMIN-only
 * (x-required-roles: ADMIN) AND HUMAN-only: RolesGuard is principal-agnostic (ADR-0011 §7 — an AGENT
 * may hold role='ADMIN'), so the coarse `@Roles('ADMIN')` gate is NOT sufficient on its own; the
 * service layer additionally asserts `actor.principalType === 'HUMAN'` (403 otherwise), closing the
 * rejected §2 "agent-issues-agent" anti-pattern structurally. Every action is audited as a HUMAN act;
 * the plaintext secret is returned ONCE and never logged. Credentials may be pre-provisioned while the
 * `agent_service_auth` master gate is off; they authenticate nothing until it is flipped on.
 */
@ApiTags('admin')
@Controller({ path: 'admin/agents', version: '1' })
export class AdminAgentCredentialController {
  constructor(private readonly service: AgentCredentialService) {}

  @Post(':agentUserId/credentials')
  @Roles('ADMIN')
  @HttpCode(201)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '[ADMIN] Issue a service credential for an AGENT account (plaintext secret returned once)' })
  issue(
    @Param('agentUserId', ParseUUIDPipe) agentUserId: string,
    @Body() dto: IssueCredentialDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<CredentialIssuedView> {
    return this.service.issue(actor, agentUserId, dto);
  }

  @Post(':agentUserId/credentials/:credId/rotate')
  @Roles('ADMIN')
  @HttpCode(201)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '[ADMIN] Rotate a credential (issue-new, link rotated_from; old NOT auto-revoked)' })
  rotate(
    @Param('agentUserId', ParseUUIDPipe) _agentUserId: string,
    @Param('credId', ParseUUIDPipe) credId: string,
    @Body() dto: RotateCredentialDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<CredentialIssuedView> {
    return this.service.rotate(actor, credId, dto);
  }

  @Delete(':agentUserId/credentials/:credId')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: '[ADMIN] Revoke a credential immediately (idempotent → 204)' })
  revoke(
    @Param('agentUserId', ParseUUIDPipe) _agentUserId: string,
    @Param('credId', ParseUUIDPipe) credId: string,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<void> {
    return this.service.revoke(actor, credId);
  }
}
