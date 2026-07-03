import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import type { AuthPrincipal } from '../../lib/auth/principal';

/**
 * Access-token signing + HS256 pin (AUDIT3 security.md #3 — alg-confusion defence). The negative:
 * a token forged with a DIFFERENT algorithm (even with the correct secret) is rejected on verify.
 */
describe('TokenService (HS256 pin)', () => {
  const secret = 'x'.repeat(32);
  const principal: AuthPrincipal = { userId: 'u-1', role: 'USER', principalType: 'HUMAN' };

  // The real service under test: HS256 on sign, algorithms:['HS256'] on verify (module wiring).
  const hs256 = new JwtService({
    secret,
    signOptions: { algorithm: 'HS256', expiresIn: '15m' },
    verifyOptions: { algorithms: ['HS256'] },
  });
  const svc = new TokenService(hs256);

  it('signs and verifies a valid HS256 access token round-trip', () => {
    const token = svc.signAccess(principal);
    const back = svc.verifyAccess(token);
    expect(back).toEqual(principal);
  });

  it('rejects a token forged with a different algorithm (HS512) even with the right secret', () => {
    // Same secret, wrong alg — the classic alg-confusion attempt. The pin must reject it.
    const hs512 = new JwtService({ secret, signOptions: { algorithm: 'HS512' } });
    const forged = hs512.sign(
      { role: principal.role, principal_type: principal.principalType },
      { subject: principal.userId },
    );
    expect(() => svc.verifyAccess(forged)).toThrow();
  });

  it('rejects an "alg":"none" unsigned token', () => {
    const b64 = (o: unknown): string =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const header = b64({ alg: 'none', typ: 'JWT' });
    const payload = b64({ sub: principal.userId, role: 'ADMIN', principal_type: 'HUMAN' });
    const noneToken = `${header}.${payload}.`;
    expect(() => svc.verifyAccess(noneToken)).toThrow();
  });
});
