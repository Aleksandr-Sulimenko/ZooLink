import type { OrgMembershipService } from '../../lib/org/org-membership.service';

/**
 * Event → notification mapping (ADR-0021 §5 + event-catalog.md §3). The consumer's dispatch core stays
 * dumb; ALL per-event knowledge lives here as a registry, one entry per `eventType`. Adding a new
 * notifiable event (or a new Offering type, ADR-0014) is a registry edit — never a change to the
 * consumer. The allow-list of subscribed events is exactly `Object.keys(NOTIFICATION_REGISTRY)` (NOT
 * `'*'`): the consumer only sees the events it is registered for.
 */
export interface RegistryDeps {
  readonly orgMembership: OrgMembershipService;
}

export interface NotificationRoute {
  /**
   * Template NAME to render for this event, chosen from the payload (some events branch — e.g.
   * `Moderation.Decided` maps to listing_approved / _rejected / _changes_requested by `decision`).
   * Returns `null` to skip (event carried a shape with no notification).
   */
  templateFor(payload: Payload): string | null;
  /**
   * Recipient USER ids. Resolved from the payload the owning module stamped (no raw cross-aggregate
   * join, ADR-0018) and, for an org-directed recipient, fanned out via the org aggregate's own service.
   */
  recipients(payload: Payload, deps: RegistryDeps): Promise<string[]>;
  /** Flat `{{key}}` → value context for template rendering. */
  context(payload: Payload): Record<string, string>;
}

type Payload = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Recipient = a concrete user, or (if org-directed) every ACTIVE org-admin of that org. */
async function userOrOrgAdmins(
  userId: unknown,
  orgId: unknown,
  deps: RegistryDeps,
): Promise<string[]> {
  const u = str(userId);
  if (u) return [u];
  const o = str(orgId);
  if (o) return deps.orgMembership.orgAdminUserIds(o);
  return [];
}

const DECISION_TEMPLATE: Record<string, string> = {
  APPROVED: 'listing_approved',
  REJECTED: 'listing_rejected',
  CHANGES_REQUESTED: 'listing_changes_requested',
};

export const NOTIFICATION_REGISTRY: Record<string, NotificationRoute> = {
  // Moderation outcome → seller (event already produced by moderation.service; ADR-0021 §5).
  'Moderation.Decided': {
    templateFor: (p) => DECISION_TEMPLATE[str(p.decision) ?? ''] ?? null,
    recipients: (p) => {
      const seller = str(p.sellerId);
      return Promise.resolve(seller ? [seller] : []);
    },
    // The payload carries no listing title (producer not changed in this slice); fall back to the
    // entity id so the row is never rendered with an empty subject. Rich enrichment via the owning
    // ListingService is a tracked follow-up (keeps ListingModule out of the worker graph for MVP).
    context: (p) => ({
      listing_title: str(p.entityId) ?? '',
      reason: str(p.reason) ?? '',
    }),
  },

  // Ownership-transfer lifecycle. Recipient = "the other party" relative to who acted (ADR-0021 §5).
  'OwnershipTransfer.Initiated': {
    templateFor: () => 'transfer_initiated',
    // Initiated by the initiator → notify the TO-party (recipient).
    recipients: (p, d) => userOrOrgAdmins(p.toUserId, p.toOrganizationId, d),
    context: (p) => ({ transfer_id: str(p.transferId) ?? '', animal_id: str(p.animalId) ?? '' }),
  },
  'OwnershipTransfer.Accepted': {
    templateFor: () => 'transfer_accepted',
    // Accepted by the recipient → notify the FROM-party (initiator).
    recipients: (p, d) => userOrOrgAdmins(p.fromUserId, p.fromOrganizationId, d),
    context: (p) => ({ transfer_id: str(p.transferId) ?? '', animal_id: str(p.animalId) ?? '' }),
  },
  'OwnershipTransfer.Declined': {
    templateFor: () => 'transfer_declined',
    // Declined by the recipient → notify the FROM-party (initiator).
    recipients: (p, d) => userOrOrgAdmins(p.fromUserId, p.fromOrganizationId, d),
    context: (p) => ({ transfer_id: str(p.transferId) ?? '', animal_id: str(p.animalId) ?? '' }),
  },
  'OwnershipTransfer.Cancelled': {
    templateFor: () => 'transfer_cancelled',
    // Cancelled by the initiator → notify the TO-party (recipient).
    recipients: (p, d) => userOrOrgAdmins(p.toUserId, p.toOrganizationId, d),
    context: (p) => ({ transfer_id: str(p.transferId) ?? '', animal_id: str(p.animalId) ?? '' }),
  },
  'OwnershipTransfer.Expired': {
    templateFor: () => 'transfer_expired',
    // System-expired (no human actor) → notify BOTH parties (neither is "the other").
    recipients: async (p, d) => {
      const to = await userOrOrgAdmins(p.toUserId, p.toOrganizationId, d);
      const from = await userOrOrgAdmins(p.fromUserId, p.fromOrganizationId, d);
      return [...new Set([...to, ...from])];
    },
    context: (p) => ({ transfer_id: str(p.transferId) ?? '', animal_id: str(p.animalId) ?? '' }),
  },
};

/** Render `{{key}}` placeholders from a flat context; unknown keys collapse to empty. */
export function renderTemplate(body: string, ctx: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => ctx[key] ?? '');
}
