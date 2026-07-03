import { Global, Module } from '@nestjs/common';
import { ConsentService } from './consent.service';

/**
 * Consent log seam (ADR-0020). Global so any domain can record/read consent without re-importing —
 * the single writer/reader of the append-only `consents` table. Used by Identity `PATCH /me` (records
 * CONTACT_DISTRIBUTION on opt-in) and Listing `revealContact` (gates distribution on it).
 */
@Global()
@Module({
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
