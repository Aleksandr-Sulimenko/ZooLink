import { subject } from '@casl/ability';
import { AbilityFactory } from './ability.factory';
import type { AuthPrincipal } from './principal';

const factory = new AbilityFactory();
const principal = (role: AuthPrincipal['role'], userId = 'u1'): AuthPrincipal => ({
  userId,
  role,
  principalType: 'HUMAN',
});

describe('AbilityFactory', () => {
  it('ADMIN can manage everything', () => {
    const a = factory.createForPrincipal(principal('ADMIN'));
    expect(a.can('manage', 'all')).toBe(true);
    expect(a.can('delete', 'FeatureToggle')).toBe(true);
  });

  it('MODERATOR can read all and decide, but cannot manage system config', () => {
    const a = factory.createForPrincipal(principal('MODERATOR'));
    expect(a.can('read', 'ModerationQueue')).toBe(true);
    expect(a.can('create', 'ModerationDecision')).toBe(true);
    expect(a.can('update', 'FeatureToggle')).toBe(false);
  });

  it('USER can manage OWN animal but not someone else’s, and cannot touch feature toggles', () => {
    const a = factory.createForPrincipal(principal('USER', 'u1'));
    expect(a.can('update', subject('Animal', { owner_id: 'u1' }))).toBe(true);
    expect(a.can('update', subject('Animal', { owner_id: 'u2' }))).toBe(false);
    expect(a.can('read', 'FeatureToggle')).toBe(false);
    expect(a.can('create', 'ModerationDecision')).toBe(false);
  });

  it('capability roles inherit USER ownership rules', () => {
    const a = factory.createForPrincipal(principal('BREEDER', 'u9'));
    expect(a.can('manage', subject('Listing', { owner_id: 'u9' }))).toBe(true);
    expect(a.can('manage', subject('Listing', { owner_id: 'u1' }))).toBe(false);
  });
});
