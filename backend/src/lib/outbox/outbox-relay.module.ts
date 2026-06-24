import { Module } from '@nestjs/common';
import { OutboxRelay } from './outbox.relay';

/**
 * Worker-only module: starts the polling outbox relay. Not imported by the API (which only
 * writes events). Consumers are contributed by domain modules under the OUTBOX_CONSUMERS token.
 */
@Module({
  providers: [OutboxRelay],
})
export class OutboxRelayModule {}
