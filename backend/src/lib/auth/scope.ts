import type { Action, Subject } from './ability.factory';

/**
 * ADR-0037 — least-privilege scope vocabulary for AGENT principals.
 *
 * A scope is a list of `{ action, subject }` grants drawn from the SAME `Action × Subject`
 * vocabulary the RBAC matrix / AbilityFactory already defines — but with the `manage` action and
 * the `all` subject FORBIDDEN. Excluding the wildcard is what makes blanket authority structurally
 * impossible for an AGENT (AUDIT4 P1-6): the effective AGENT ability = `matrix(role) ∩ scope`, and
 * the wildcard can only ever come from the HUMAN `ADMIN` branch of the AbilityFactory.
 *
 * This type is transported on the principal as a JWT `scope` claim (populated for AGENT tokens only,
 * from the credential's capability-profile at exchange — ADR-0036 §1). HUMAN principals never carry a
 * scope (undefined ⇒ full role matrix, byte-identical to pre-ADR).
 */
export type ScopeAction = Exclude<Action, 'manage'>; // 'create' | 'read' | 'update' | 'delete'
export type ScopeSubject = Exclude<Subject, 'all'>;

export interface ScopeGrant {
  action: ScopeAction;
  subject: ScopeSubject;
}

const SCOPE_ACTIONS: ReadonlySet<string> = new Set(['read', 'create', 'update', 'delete']);

/**
 * Service-layer scope validator (ADR-0037 §2, normative): rejects any grant containing the
 * `manage` action or the `all` subject, plus malformed grants. Applied when a capability profile
 * is created/edited so a wildcard can never be persisted. Throws a plain `Error` with a stable
 * message; callers map it to a 422 `INVALID_SCOPE`.
 */
export function assertValidScope(scope: unknown): asserts scope is ScopeGrant[] {
  if (!Array.isArray(scope)) {
    throw new Error('scope must be an array of {action, subject} grants');
  }
  for (const grant of scope) {
    if (typeof grant !== 'object' || grant === null) {
      throw new Error('scope grant must be an object with action and subject');
    }
    const { action, subject } = grant as Record<string, unknown>;
    if (typeof action !== 'string' || typeof subject !== 'string') {
      throw new Error('scope grant requires a string action and a string subject');
    }
    if (action === 'manage' || subject === 'all') {
      throw new Error('scope must not contain the manage action or the all subject (ADR-0037: no wildcard for AGENT)');
    }
    if (!SCOPE_ACTIONS.has(action)) {
      throw new Error(`scope action must be one of read|create|update|delete (got "${action}")`);
    }
  }
}

/**
 * Parse an untrusted `scope` claim from a JWT into a safe `ScopeGrant[]`. Any grant that is not a
 * well-formed non-wildcard `{action, subject}` is dropped (fail-safe: a malformed claim narrows,
 * never widens). Returns `undefined` for a missing/empty scope so a HUMAN token stays scope-free.
 */
export function parseScopeClaim(raw: unknown): ScopeGrant[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const grants: ScopeGrant[] = [];
  for (const g of raw) {
    if (typeof g !== 'object' || g === null) continue;
    const { action, subject } = g as Record<string, unknown>;
    if (typeof action !== 'string' || typeof subject !== 'string') continue;
    if (action === 'manage' || subject === 'all') continue; // never honour a wildcard on the AGENT path
    if (!SCOPE_ACTIONS.has(action)) continue;
    grants.push({ action: action as ScopeAction, subject: subject as ScopeSubject });
  }
  return grants.length ? grants : undefined;
}
