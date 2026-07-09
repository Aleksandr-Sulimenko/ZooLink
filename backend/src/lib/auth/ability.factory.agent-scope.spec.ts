import { subject } from '@casl/ability';
import { AbilityFactory } from './ability.factory';
import type { AuthPrincipal, Role } from './principal';
import type { ScopeGrant } from './scope';

/**
 * ADR-0037 §5 parity test (Definition-of-Done, verbatim):
 *  1. a HUMAN principal's abilities are unchanged across every role (byte-identical to pre-ADR);
 *  2. an AGENT with NULL scope resolves to NO abilities (deny-by-default);
 *  3. an AGENT with `moderation-agent` scope resolves to EXACTLY matrix(MODERATOR) ∩ scope;
 *  4. an AGENT at role='ADMIN' NEVER resolves manage:all.
 */
const factory = new AbilityFactory();
const ALL_ROLES: Role[] = ['USER', 'MODERATOR', 'ADMIN', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER'];

const human = (role: Role, userId = 'u1'): AuthPrincipal => ({ userId, role, principalType: 'HUMAN' });
const agent = (role: Role, scope: ScopeGrant[] | undefined, userId = 'a1'): AuthPrincipal => ({
  userId,
  role,
  principalType: 'AGENT',
  scope,
});

const MODERATION_AGENT_SCOPE: ScopeGrant[] = [
  { action: 'read', subject: 'ModerationQueue' },
  { action: 'create', subject: 'ModerationDecision' },
  { action: 'read', subject: 'Listing' },
  { action: 'read', subject: 'ContentReport' },
];

describe('AbilityFactory — AGENT scoped ability (ADR-0037 §5 DoD)', () => {
  // (1) HUMAN unchanged across every role — a HUMAN is byte-identical whether or not a scope field
  // is even present. We compare a HUMAN principal to one carrying a (ignored) scope field.
  describe('(1) HUMAN behaviour is unchanged across every role', () => {
    it.each(ALL_ROLES)('role %s: HUMAN abilities do not depend on any scope field', (role) => {
      const plain = factory.createForPrincipal(human(role));
      const withIgnoredScope = factory.createForPrincipal({
        ...human(role),
        scope: MODERATION_AGENT_SCOPE, // must be IGNORED for a HUMAN
      });
      expect(JSON.stringify(withIgnoredScope.rules)).toEqual(JSON.stringify(plain.rules));
    });

    it('HUMAN ADMIN still has manage:all; HUMAN MODERATOR still updates listings/users', () => {
      const admin = factory.createForPrincipal(human('ADMIN'));
      expect(admin.can('manage', 'all')).toBe(true);
      const mod = factory.createForPrincipal(human('MODERATOR'));
      expect(mod.can('update', 'Listing')).toBe(true);
      expect(mod.can('update', 'User')).toBe(true);
      expect(mod.can('read', 'AuditLog')).toBe(true);
    });
  });

  // (2) AGENT with null / empty scope → NOTHING.
  describe('(2) AGENT with null/empty scope is denied everything (deny-by-default)', () => {
    it.each(ALL_ROLES)('role %s: AGENT with undefined scope can do nothing', (role) => {
      const a = factory.createForPrincipal(agent(role, undefined));
      expect(a.can('read', 'ModerationQueue')).toBe(false);
      expect(a.can('create', 'ModerationDecision')).toBe(false);
      expect(a.can('read', 'Listing')).toBe(false);
      expect(a.can('manage', 'all')).toBe(false);
      expect(a.rules).toHaveLength(0);
    });

    it('AGENT with an empty scope array can do nothing', () => {
      const a = factory.createForPrincipal(agent('MODERATOR', []));
      expect(a.rules).toHaveLength(0);
    });
  });

  // (3) AGENT + moderation-agent scope → EXACTLY matrix(MODERATOR) ∩ scope.
  describe('(3) AGENT-MODERATOR with moderation-agent scope = matrix(MODERATOR) ∩ scope', () => {
    const a = factory.createForPrincipal(agent('MODERATOR', MODERATION_AGENT_SCOPE));

    it('grants exactly the four scoped abilities', () => {
      expect(a.can('read', 'ModerationQueue')).toBe(true);
      expect(a.can('create', 'ModerationDecision')).toBe(true);
      expect(a.can('read', 'Listing')).toBe(true);
      expect(a.can('read', 'ContentReport')).toBe(true);
    });

    it('is strictly narrower than the MODERATOR role ceiling (least-privilege)', () => {
      // The human MODERATOR CAN do these; the scoped agent must NOT.
      expect(a.can('update', 'Listing')).toBe(false);
      expect(a.can('update', 'User')).toBe(false);
      expect(a.can('read', 'AuditLog')).toBe(false);
      expect(a.can('update', 'ContentReport')).toBe(false);
      expect(a.can('manage', 'all')).toBe(false);
    });

    it('a scope grant the role ceiling forbids is not granted (intersection, not union)', () => {
      // USER-role agent asking for a MODERATOR-only ability → denied (role is the ceiling).
      const u = factory.createForPrincipal(agent('USER', [{ action: 'create', subject: 'ModerationDecision' }]));
      expect(u.can('create', 'ModerationDecision')).toBe(false);
    });

    it('preserves ownership conditions from the ceiling (no widening)', () => {
      // USER matrix grants manage Animal ONLY for own rows; a scoped {update, Animal} must stay owner-scoped.
      const owner = factory.createForPrincipal(agent('USER', [{ action: 'update', subject: 'Animal' }], 'owner-1'));
      expect(owner.can('update', subject('Animal', { owner_id: 'owner-1' }))).toBe(true);
      expect(owner.can('update', subject('Animal', { owner_id: 'someone-else' }))).toBe(false);
    });
  });

  // Canary (F4): the AGENT scope intersection only reads GRANT rules; it does NOT yet subtract
  // `cannot` (inverted) rules. buildRoleMatrix must emit NONE today. If a future domain rule adds a
  // `cannot` to the matrix, this fails first — teach matchingCeilingRule to subtract cannot-rules before
  // that rule ships, or an AGENT scope could be granted an ability the human role is explicitly denied.
  describe('canary — the role matrix has no inverted (cannot) rules yet', () => {
    it.each(ALL_ROLES)('role %s emits only grant rules', (role) => {
      const matrix = factory.createForPrincipal(human(role));
      const inverted = matrix.rules.filter((r) => r.inverted);
      expect(inverted).toEqual([]); // AGENT intersection must be taught cannot-rules first
    });
  });

  // (4) AGENT at role='ADMIN' NEVER resolves manage:all.
  describe('(4) AGENT-ADMIN never resolves manage:all', () => {
    it('with a narrow scope, gets only that scope — never the wildcard', () => {
      const a = factory.createForPrincipal(agent('ADMIN', [{ action: 'read', subject: 'User' }]));
      expect(a.can('read', 'User')).toBe(true);
      expect(a.can('manage', 'all')).toBe(false);
      expect(a.can('delete', 'User')).toBe(false);
      expect(a.can('update', 'FeatureToggle')).toBe(false);
      expect(a.can('delete', 'FeatureToggle')).toBe(false);
    });

    it('a scope that literally tries to name manage/all is dropped', () => {
      const a = factory.createForPrincipal(
        agent('ADMIN', [
          { action: 'manage' as never, subject: 'all' as never },
          { action: 'read', subject: 'User' },
        ]),
      );
      expect(a.can('manage', 'all')).toBe(false);
      expect(a.can('read', 'User')).toBe(true);
      // only the one legitimate grant survives
      expect(a.rules).toHaveLength(1);
    });
  });
});
