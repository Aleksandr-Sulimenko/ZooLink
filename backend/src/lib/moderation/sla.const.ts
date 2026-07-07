import type { Market } from '../market/market.const';

/**
 * Moderation SLA targets (MVP). Single source of truth — Wave F dedup (was duplicated verbatim in
 * the HTTP queue `modules/moderation/moderation.service` and the worker
 * `lib/scheduler/moderation-escalation.service`, which had to be kept in lock-step by hand).
 *
 * A listing breaches SLA after `SLA_TARGET_SECONDS[market]` and escalates after
 * `SLA_TARGET_SECONDS[market] * ESCALATE_FACTOR` (pet <4h, livestock <6h; ×2 → escalate at 8h/12h).
 */
export const SLA_TARGET_SECONDS: Record<Market, number> = { pet: 4 * 3600, livestock: 6 * 3600 };
export const ESCALATE_FACTOR = 2;
