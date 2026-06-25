import { BadRequestException } from '@nestjs/common';
import { AuditService } from './audit.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { AuditLogRow } from '../../lib/audit/audit.types';
import type { ListAuditLogQueryDto } from './dto/audit-log.dto';

const row = (over: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id: 'a1',
  entity_type: 'user',
  entity_id: 'u1',
  entity_id_int: null,
  action: 'identity.role_changed',
  actor_id: 'admin-1',
  actor_role: 'ADMIN',
  actor_principal_type: 'HUMAN',
  after_data: { role: 'BREEDER' },
  ip_address: '10.0.0.1',
  user_agent: 'jest',
  created_at: new Date('2026-06-24T00:00:00Z'),
  ...over,
});

function setup(rows: AuditLogRow[] = [row()], total = 1, users: { id: string; full_name: string }[] = [{ id: 'admin-1', full_name: 'Admin Ann' }]) {
  const query = jest.fn().mockResolvedValue({ rows, total });
  const audit = { query } as unknown as AuditLogService;
  const findMany = jest.fn().mockResolvedValue(users);
  const prisma = { users: { findMany } } as unknown as PrismaService;
  return { svc: new AuditService(prisma, audit), query, findMany };
}

const base = (over: Partial<ListAuditLogQueryDto> = {}): ListAuditLogQueryDto => ({
  page: 1,
  limit: 50,
  sort: 'created_at:desc',
  ...over,
});

describe('AuditService.list', () => {
  it('maps a row to the AuditLogEntry wire shape with the actor badge and verbatim actionType', async () => {
    const { svc } = setup();
    const res = await svc.list(base());
    expect(res.meta).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
    const e = res.items[0];
    expect(e.entityType).toBe('user');
    expect(e.referenceDataset).toBeNull();
    expect(e.entityId).toBe('u1');
    expect(e.entityIdInt).toBeNull();
    // reconciled vocabulary: the stored verb is returned VERBATIM (no enum collapse).
    expect(e.actionType).toBe('identity.role_changed');
    expect(e.actor).toEqual({ actorId: 'admin-1', principalType: 'HUMAN', actorDisplayName: 'Admin Ann' });
    expect(e.details).toBe(JSON.stringify({ role: 'BREEDER' }));
  });

  it('rejects entityId + entityIdInt together with 400 VALIDATION_ERROR', async () => {
    const { svc, query } = setup();
    await expect(svc.list(base({ entityId: 'u1', entityIdInt: 5 }))).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects endDate before startDate with 400', async () => {
    const { svc } = setup();
    await expect(svc.list(base({ startDate: '2026-06-10', endDate: '2026-06-01' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalises a suffixed reference-data entity_type to bare + splits out referenceDataset + INT id', async () => {
    const { svc } = setup([row({ entity_type: 'reference-data:species', entity_id: null, entity_id_int: 7, action: 'reference_data.created' })]);
    const e = (await svc.list(base())).items[0];
    expect(e.entityType).toBe('reference-data');
    expect(e.referenceDataset).toBe('species');
    expect(e.entityId).toBeNull();
    expect(e.entityIdInt).toBe(7);
    expect(e.actionType).toBe('reference_data.created'); // verbatim
  });

  it('normalises the stored feature_toggle entity_type to the contract feature-toggle form', async () => {
    const { svc } = setup([row({ entity_type: 'feature_toggle', entity_id: null, action: 'feature_toggle.flip', after_data: { key: 'payments' } })]);
    const e = (await svc.list(base())).items[0];
    expect(e.entityType).toBe('feature-toggle');
    expect(e.referenceDataset).toBeNull();
    expect(e.actionType).toBe('feature_toggle.flip');
  });

  it('passes the actionType filter as an EXACT action match (no LIKE remap) + offset/limit/sortDir', async () => {
    const { svc, query } = setup();
    await svc.list(base({ page: 2, limit: 10, actionType: 'identity.role_changed', actorId: 'admin-1', entityType: 'user', sort: 'created_at:asc' }));
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'user',
        actorId: 'admin-1',
        action: 'identity.role_changed',
        sortDir: 'asc',
        limit: 10,
        offset: 10,
      }),
    );
    // the old lossy LIKE plumbing is gone
    expect(query).toHaveBeenCalledWith(expect.not.objectContaining({ actionLike: expect.anything() }));
  });

  it('maps referenceDataset to the exact suffixed entity_type and drops the bare entityType match', async () => {
    const { svc, query } = setup();
    await svc.list(base({ entityType: 'reference-data', referenceDataset: 'breeds' }));
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ entityTypeExact: 'reference-data:breeds', entityType: undefined }),
    );
  });

  it('preserves the agent principalType badge for an AGENT actor', async () => {
    const { svc } = setup([row({ actor_principal_type: 'AGENT', actor_id: 'agent-9' })], 1, [{ id: 'agent-9', full_name: 'Mod Agent' }]);
    const e = (await svc.list(base())).items[0];
    expect(e.actor.principalType).toBe('AGENT');
    expect(e.actor.actorDisplayName).toBe('Mod Agent');
  });

  it('handles a null actor (system action) without a name lookup', async () => {
    const { svc, findMany } = setup([row({ actor_id: null })]);
    const e = (await svc.list(base())).items[0];
    expect(e.actor).toEqual({ actorId: null, principalType: 'HUMAN', actorDisplayName: null });
    expect(findMany).not.toHaveBeenCalled();
  });
});
