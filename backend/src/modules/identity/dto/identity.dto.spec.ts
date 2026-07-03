import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OAuthDto, RegisterPhoneDto, UpdateProfileDto } from './identity.dto';

/**
 * avatarUrl stored-XSS hardening (AUDIT3 security.md #2 / frontend-engineer). The three DTOs that
 * accept an avatar URL must reject `javascript:`/`data:`/protocol-relative/http and accept only
 * https URLs (class-validator is the runtime gate; OpenAPI `format:uri` is documentation-only).
 */
describe('identity DTOs — avatarUrl @IsUrl https-only allowlist', () => {
  const avatarErrors = (Dto: unknown, avatarUrl: unknown, base: Record<string, unknown>) => {
    const instance = plainToInstance(Dto as never, { ...base, avatarUrl });
    return validateSync(instance as object).filter((e) => e.property === 'avatarUrl');
  };

  const phoneBase = { phone: '+79991234567', fullName: 'Ann Tester' };
  const oauthBase = { code: 'x', fullName: 'Oauth User' };
  const profileBase = {};

  const cases: Array<[string, unknown, Record<string, unknown>]> = [
    ['RegisterPhoneDto', RegisterPhoneDto, phoneBase],
    ['OAuthDto', OAuthDto, oauthBase],
    ['UpdateProfileDto', UpdateProfileDto, profileBase],
  ];

  const rejected = [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example.com/x.png',
    'http://cdn.example.com/x.png', // http rejected — https only
    'not a url',
  ];

  for (const [name, Dto, base] of cases) {
    describe(name, () => {
      for (const bad of rejected) {
        it(`400s on ${JSON.stringify(bad)}`, () => {
          expect(avatarErrors(Dto, bad, base).length).toBeGreaterThan(0);
        });
      }

      it('accepts a valid https URL', () => {
        expect(avatarErrors(Dto, 'https://cdn.example.com/avatar.png', base)).toHaveLength(0);
      });

      it('accepts an omitted avatarUrl (optional)', () => {
        expect(avatarErrors(Dto, undefined, base)).toHaveLength(0);
      });
    });
  }

  it('UpdateProfileDto accepts null avatarUrl (clears it)', () => {
    const instance = plainToInstance(UpdateProfileDto, { avatarUrl: null });
    expect(validateSync(instance).filter((e) => e.property === 'avatarUrl')).toHaveLength(0);
  });

  // ── ADR-0020: contact-channel fields ──────────────────────────────────────────────────────────
  const errsFor = (body: Record<string, unknown>, prop: string) =>
    validateSync(plainToInstance(UpdateProfileDto, body)).filter((e) => e.property === prop);

  it('accepts a valid contactPhone (E.164) + showPhone + telegram handle', () => {
    const body = { contactPhone: '+79991234567', contactTelegram: '@seller_1', showPhone: true, showTelegram: false };
    expect(validateSync(plainToInstance(UpdateProfileDto, body))).toHaveLength(0);
  });

  it('rejects a non-E.164 contactPhone', () => {
    expect(errsFor({ contactPhone: '12345' }, 'contactPhone').length).toBeGreaterThan(0);
    expect(errsFor({ contactPhone: 'notaphone' }, 'contactPhone').length).toBeGreaterThan(0);
  });

  it('rejects a malformed contactTelegram (too short / illegal chars)', () => {
    expect(errsFor({ contactTelegram: 'ab' }, 'contactTelegram').length).toBeGreaterThan(0);
    expect(errsFor({ contactTelegram: 'has space' }, 'contactTelegram').length).toBeGreaterThan(0);
  });

  it('rejects a non-boolean showPhone', () => {
    expect(errsFor({ showPhone: 'yes' }, 'showPhone').length).toBeGreaterThan(0);
  });
});
