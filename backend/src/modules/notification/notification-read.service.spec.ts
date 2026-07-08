import { NotificationReadService } from './notification-read.service';
import { NotificationListQueryDto } from './dto/notification.dto';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuthPrincipal } from '../../lib/auth/principal';

const actor = (userId: string): AuthPrincipal =>
  ({ userId, role: 'USER', principalType: 'HUMAN' }) as unknown as AuthPrincipal;

const query = (over: Partial<NotificationListQueryDto> = {}): NotificationListQueryDto =>
  Object.assign(new NotificationListQueryDto(), over);

function make(rows: Record<string, unknown>[], total = rows.length) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(total);
  const prisma = { notification_logs: { findMany, count } } as unknown as PrismaService;
  return { service: new NotificationReadService(prisma), findMany, count };
}

describe('NotificationReadService', () => {
  it('lists only the caller-own IN_APP rows (own-scope + channel filter — IDOR closed)', async () => {
    const { service, findMany, count } = make([
      { id: 'n1', type: 'IN_APP', content: 'Approved', status: 'SENT', created_at: new Date('2026-07-08T10:00:00Z'), updated_at: new Date('2026-07-08T10:00:00Z') },
    ]);

    const { page } = await service.list(query(), actor('u1'));

    // Both the query and the count restrict to (user_id=actor, type=IN_APP) — no operator widening.
    const expectedWhere = { user_id: 'u1', type: 'IN_APP' };
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: expectedWhere, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(page.items).toEqual([
      { id: 'n1', type: 'IN_APP', content: 'Approved', status: 'SENT', createdAt: new Date('2026-07-08T10:00:00Z') },
    ]);
    expect(page.meta).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('paginates via skip/take from the query', async () => {
    const { service, findMany } = make([], 55);
    await service.list(query({ page: 3, limit: 10 }), actor('u1'));
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
  });

  it('emits a weak ETag that rotates when a newer row lands (inbox validator)', async () => {
    const baseRow = { id: 'n1', type: 'IN_APP', content: 'x', status: 'SENT', created_at: new Date('2026-07-08T10:00:00Z'), updated_at: new Date('2026-07-08T10:00:00Z') };
    const first = await make([baseRow], 1).service.list(query(), actor('u1'));
    // A newer row (later updated_at) + higher total → the validator must change.
    const newerRow = { ...baseRow, id: 'n2', updated_at: new Date('2026-07-08T11:00:00Z') };
    const second = await make([newerRow, baseRow], 2).service.list(query(), actor('u1'));
    expect(first.etag).toMatch(/^W\//);
    expect(second.etag).not.toBe(first.etag);
  });

  it('returns an empty page (stable ETag) for a user with no notifications', async () => {
    const { service } = make([], 0);
    const { page, etag } = await service.list(query(), actor('u1'));
    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(0);
    expect(etag).toMatch(/^W\//);
  });
});
