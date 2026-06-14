# User State Machine Specification

## Overview
Defines the lifecycle states and transitions for a user account in the ZooLink system.

## States

| State | Description | Entry Actions | Exit Actions |
|-------|-------------|---------------|--------------|
| **UNVERIFIED** | Initial state after registration; user cannot perform core actions (create listings, etc.) | - Send verification code via SMS/OAuth<br>- Log registration attempt | - Clear verification code from memory (if sent) |
| **PENDING_VERIFICATION** | Verification process initiated; awaiting user response | - Start verification attempt timer<br>- Increment verification attempt counter | - Stop verification timer |
| **VERIFIED** | User has successfully verified identity via SMS/OAuth | - Grant basic platform access<br>- Log successful verification | - None |
| **ACTIVE** | Fully verified user with full access to platform features | - Enable listing creation/modification<br>- Grant access to all core features | - None |
| **SUSPENDED** | Temporarily restricted access due to policy violations | - Disable listing creation/modification<br>- Send notification of suspension<br>- Log suspension reason | - None |
| **DEACTIVATED** | Permanently deactivated account (user-requested or admin action) | - Anonymize personal data per GDPR<br>- Revoke all access tokens<br>- Log deactivation | - None |

## State Transitions

| From State | To State | Trigger | Guard Condition | Action |
|------------|----------|---------|-----------------|--------|
| UNVERIFIED | PENDING_VERIFICATION | Registration completed | Verification method (SMS/OAuth) selected | Send verification code |
| PENDING_VERIFICATION | VERIFIED | Verification code submitted | Code matches && attempts < MAX_ATTEMPTS | Clear verification data |
| PENDING_VERIFICATION | UNVERIFIED | Verification failed | attempts >= MAX_ATTEMPTS || user requested resend | Increment attempt counter; optionally resend code |
| PENDING_VERIFICATION | UNVERIFIED | Registration abandoned | Session timeout || user navigated away | Clear temporary data |
| VERIFIED | ACTIVE | Profile completion (if required) | All mandatory profile fields filled | Activate full account |
| VERIFIED | ACTIVE | Automatic activation (no profile req) | Time elapsed > VERIFICATION_GRACE_PERIOD | Activate full account |
| ACTIVE | SUSPENDED | Moderation action | Violation severity >= SUSPENSION_THRESHOLD | Notify user; log violation |
| SUSPENDED | ACTIVE | Appeal successful | Moderation review outcome = APPROVED | Restore access; log appeal result |
| SUSPENDED | DEACTIVATED | Appeal failed OR suspension expired | Moderation review outcome = REJECTED || time in suspension > MAX_SUSPENSION_DURATION | Initiate deactivation process |
| ACTIVE | DEACTIVATED | User request | User initiated account deletion | Anonymize data; revoke tokens |
| ACTIVE | DEACTIVATED | Administrative action | Violation severity = TERMINATION_THRESHOLD | Anonymize data; log admin action |
| * | DEACTIVATED | System mandate | Legal requirement (e.g., right to be forgotten) | Anonymize data; log compliance action |

## Constants & Configuration
- `MAX_ATTEMPTS`: 5 (verification code attempts)
- `VERIFICATION_GRACE_PERIOD`: 24 hours (time to complete verification)
- `MAX_SUSPENSION_DURATION`: 30 days (maximum suspension before auto-deactivation)
- `SUSPENSION_THRESHOLD`: Violation score >= 70 (based on violation type weights)
- `TERMINATION_THRESHOLD`: Violation score >= 90

## Notes
- All state transitions are logged with timestamp, user ID, and trigger context for audit trails.
- Terminal states: VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED (UNVERIFIED and PENDING_VERIFICATION are transient).
- From DEACTIVATED, no transitions are possible (account is permanently removed from active systems).