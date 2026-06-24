import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from './principal';
import type { RequestAuthenticator } from './request-authenticator';

/**
 * ADR-0011 §5 — FORWARD-COMPATIBLE STUB. NOT wired into the chain in MVP, and gated even if it were.
 *
 * This is the additive future link that will authenticate an AGENT principal from a scoped service
 * token, verifying it against the rotatable/revocable `service_credentials` store (migration 0017)
 * and the `AGENT_SERVICE_SIGNING_SECRET`. It returns the SAME {@link AuthPrincipal} shape as
 * {@link BearerJwtAuthenticator}, so everything downstream (RBAC matrix, CASL, actor snapshotting)
 * is already source-agnostic and needs no change when agents go live (ADR-0006 P-A…P-D).
 *
 * Behaviour is gated: in MVP the AGENT gate is OFF, no agent token is ever issued or verified, and
 * this authenticator deliberately returns `null` for every request. Only the *form* ships now — per
 * the phasing rule, no schema/contract/authz rewrite is needed to activate it later (just implement
 * verification here and add it to REQUEST_AUTHENTICATORS in AuthModule). It is intentionally left
 * out of the provider list / chain so it cannot change HUMAN behaviour today.
 */
@Injectable()
export class AgentServiceTokenAuthenticator implements RequestAuthenticator {
  tryAuthenticate(_req: Request): AuthPrincipal | null {
    // AGENT gate OFF (MVP): no agent service tokens are issued or verified. Form only — see class doc.
    // Future (P-A): read the agent service token, look up + verify against service_credentials
    // (is_active, not revoked) using AGENT_SERVICE_SIGNING_SECRET, then return
    // { userId, role, principalType: 'AGENT' }. Until then, always null.
    return null;
  }
}
