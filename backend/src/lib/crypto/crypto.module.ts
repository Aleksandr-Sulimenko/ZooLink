import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/**
 * PII-at-rest crypto seam (ADR-0019 / ADR-0012). Global so any domain can field-encrypt/decrypt PII
 * and compute blind indexes without re-importing — the single, versioned swap-point for the primitive.
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
