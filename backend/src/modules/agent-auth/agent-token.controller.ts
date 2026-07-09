import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../lib/auth/public.decorator';
import { AgentCredentialService } from './agent-credential.service';
import { AgentTokenExchangeDto, type AgentAccessTokenView } from './dto/agent-auth.dto';

/**
 * ADR-0036 §1 — the credential→token exchange. A machine presents its long-lived
 * `zlk_agent_<credId>_<secret>` secret ONCE here and receives a short-lived AGENT access JWT (carrying
 * the resolved least-privilege scope). No refresh token is issued — an agent re-exchanges its secret.
 * Public (no bearer required to obtain the first token); gated by the `agent_service_auth` master
 * toggle (off in MVP → 403); rate-limited per credId + IP; any verify failure → one uniform 401.
 */
@ApiTags('auth')
@Controller({ path: 'auth/agent', version: '1' })
export class AgentTokenController {
  constructor(private readonly service: AgentCredentialService) {}

  @Public()
  @Post('token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange an agent service-credential for a short-lived AGENT access token' })
  exchange(
    @Body() dto: AgentTokenExchangeDto,
    @Ip() ip: string,
  ): Promise<AgentAccessTokenView> {
    return this.service.exchange(dto.credential, ip);
  }
}
