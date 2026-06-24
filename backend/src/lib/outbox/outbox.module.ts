import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';

/**
 * Outbox writer, available everywhere (API + worker) so any domain can publish events inside
 * its own transaction. The relay that delivers them lives in the worker (OutboxRelayModule).
 */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
