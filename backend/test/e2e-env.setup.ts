/**
 * e2e global env setup (jest `setupFiles`, runs once BEFORE each e2e file is required).
 *
 * AUDIT4 P1-4 introduced a per-user 24h listing-creation quota (production default 20). Several e2e
 * suites legitimately create many listings for a single seller within one run (e.g. listing.e2e-spec
 * creates 28) — they exercise listing behaviour, NOT the quota — so they must not be throttled by it.
 * We set a generous ceiling here. The dedicated `listing-creation-quota.e2e-spec` overrides this to a
 * small value at its OWN module top-level (which executes AFTER this setup file), so the quota proof is
 * unaffected; this reset then re-applies before every subsequent file.
 */
process.env.LISTING_CREATION_QUOTA_PER_DAY = '1000';

// Agent-auth (ADR-0036 §3.2): the HMAC key for service_credentials.secret_hash. Optional in dev/test,
// but the agent-auth e2e/exchange paths require it to hash & verify a credential — set a fixed test
// value here so every e2e boot has it (dotenv does not override an already-set process.env var).
process.env.AGENT_SERVICE_SIGNING_SECRET =
  process.env.AGENT_SERVICE_SIGNING_SECRET || 'e2e_agent_service_signing_secret_00000000';
