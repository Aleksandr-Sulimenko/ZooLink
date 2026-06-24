import { OutboxRelay } from './outbox.relay';
import { MAX_ATTEMPTS } from './backoff';
import type { PrismaService } from '../db/prisma.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { OutboxConsumer } from './outbox.types';

interface Row {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'e1',
  aggregate_type: 'Listing',
  aggregate_id: 'a1',
  event_type: 'Listing.Approved',
  payload: { foo: 'bar' },
  attempts: 1,
  ...over,
});

function makeRelay(claimed: Row[], consumers: OutboxConsumer[] = []) {
  const update = jest.fn().mockResolvedValue({});
  const queryRaw = jest.fn().mockResolvedValue(claimed);
  const executeRaw = jest.fn().mockResolvedValue(1);
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    outbox_events: { update },
  } as unknown as PrismaService;
  const config = { isTest: true } as AppConfigService;
  return { relay: new OutboxRelay(prisma, config, consumers), update, queryRaw, executeRaw };
}

describe('OutboxRelay.tick', () => {
  it('delivers to a matching consumer and marks the event processed', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const consumer: OutboxConsumer = { eventTypes: ['Listing.Approved'], handle };
    const { relay, update, executeRaw } = makeRelay([row()], [consumer]);

    const n = await relay.tick();

    expect(n).toBe(1);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { processed_at: expect.any(Date), last_error: null },
    });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('marks events with no matching consumer as processed', async () => {
    const handle = jest.fn();
    const consumer: OutboxConsumer = { eventTypes: ['Other.Event'], handle };
    const { relay, update } = makeRelay([row()], [consumer]);

    await relay.tick();

    expect(handle).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { processed_at: expect.any(Date), last_error: null },
    });
  });

  it('honours a wildcard consumer', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const { relay } = makeRelay([row()], [{ eventTypes: '*', handle }]);
    await relay.tick();
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('reschedules with backoff when a consumer throws (below the attempt cap)', async () => {
    const consumer: OutboxConsumer = {
      eventTypes: '*',
      handle: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const { relay, update, executeRaw } = makeRelay([row({ attempts: 2 })], [consumer]);

    await relay.tick();

    expect(executeRaw).toHaveBeenCalledTimes(1); // backoff UPDATE
    expect(update).not.toHaveBeenCalled(); // not processed, not dead-lettered
  });

  it('dead-letters when attempts reach the cap', async () => {
    const consumer: OutboxConsumer = {
      eventTypes: '*',
      handle: jest.fn().mockRejectedValue(new Error('still bad')),
    };
    const { relay, update, executeRaw } = makeRelay([row({ attempts: MAX_ATTEMPTS })], [consumer]);

    await relay.tick();

    expect(executeRaw).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { last_error: expect.any(String), dead_lettered_at: expect.any(Date) },
    });
  });

  it('does not run reentrantly', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const queryRaw = jest.fn().mockReturnValue(gate.then(() => [] as Row[]));
    const prisma = {
      $queryRaw: queryRaw,
      $executeRaw: jest.fn(),
      outbox_events: { update: jest.fn() },
    } as unknown as PrismaService;
    const relay = new OutboxRelay(prisma, { isTest: true } as AppConfigService, []);

    const first = relay.tick();
    const second = await relay.tick();
    expect(second).toBe(0);

    release();
    await first;
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
