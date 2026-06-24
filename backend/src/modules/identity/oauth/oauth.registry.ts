import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { TelegramOAuthAdapter } from './telegram.adapter';
import { StubOAuthProvider } from './stub-oauth.adapter';
import { isOAuthProvider, type OAuthProvider, type OAuthProviderName } from './oauth.types';

/**
 * Resolves the OAuth adapter for a provider name. Real adapter when credentials are configured;
 * otherwise a dev/test stub — but in PRODUCTION an unconfigured provider is rejected (503) rather
 * than stub-authenticating. Telegram is implemented for real (HMAC, no network); Google/Apple/VK
 * real adapters are tracked follow-ups (Slice 2b) and currently stub-in-dev / reject-in-prod.
 */
@Injectable()
export class OAuthRegistry {
  constructor(private readonly config: AppConfigService) {}

  resolve(provider: string): OAuthProvider {
    if (!isOAuthProvider(provider)) {
      throw new BadRequestException({ message: `Unsupported OAuth provider: ${provider}`, code: 'VALIDATION_ERROR' });
    }

    const real = this.realAdapter(provider);
    if (real) return real;

    if (this.config.isProduction) {
      throw new HttpException(
        { message: `OAuth provider '${provider}' is not configured`, code: 'UPSTREAM_UNAVAILABLE' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return new StubOAuthProvider(provider);
  }

  /** Returns a real adapter only when its credentials are present. */
  private realAdapter(provider: OAuthProviderName): OAuthProvider | null {
    if (provider === 'telegram') {
      const token = this.config.get('OAUTH_TELEGRAM_BOT_TOKEN');
      return token ? new TelegramOAuthAdapter(token) : null;
    }
    // google / apple / vk real adapters: Slice 2b (need live secrets / JWKS).
    return null;
  }
}
