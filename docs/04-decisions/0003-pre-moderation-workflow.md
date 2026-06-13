# ADR-0003: Pre-Moderation Workflow for Listings

**Status**: Accepted  
**Date**: 2026-05-29  

## Context and Problem Statement

The ZooLink platform requires that all listings undergo moderation before becoming publicly visible. This pre-moderation approach is essential to maintain platform quality, prevent fraud, ensure compliance with regulations, and protect users from inappropriate content. However, we need to define a clear workflow that balances thorough review with acceptable time-to-market for legitimate listings.

Initially, we considered post-moderation (listings appear immediately, then reviewed) or no moderation (relying solely on user reporting). However, analysis showed these approaches would compromise platform integrity and user trust, especially given the nature of animal transactions which involve significant financial and emotional value.

## Decision Drivers

1. **Platform Integrity**: Prevent scams, fraudulent listings, and inappropriate content
2. **User Safety**: Protect buyers and sellers from malicious actors
3. **Regulatory Compliance**: Especially important for livestock movement tracking and documentation
4. **Quality Standards**: Ensure listings meet minimum completeness and accuracy requirements
5. **Moderator Efficiency**: Clear workflow reduces cognitive load and improves consistency
6. **User Expectations**: Users should understand why listings aren't immediately visible
7. **Time-to-Market**: Legitimate listings should be published within reasonable timeframes

## Considered Options

### Option 1: Post-Moderation (Listings appear immediately, then reviewed)
Listings go live immediately upon creation, with moderation occurring asynchronously.

Pros:
- Instant gratification for sellers
- Simpler technical implementation
- No delay in listing visibility

Cons:
- Fraudulent/scam listings visible to users before removal
- Negative user experience when legitimate users encounter bad content
- Difficult to enforce quality standards upfront
- Potential legal liability for hosting illegal content temporarily
- Requires reactive takedown rather than preventive measures

### Option 2: No Formal Moderation (Rely on user reporting)
Listings appear immediately, with moderation only occurring when users report issues.

Pros:
- Minimal technical overhead
- Fastest possible listing publication

Cons:
- High likelihood of harmful content persisting until reported
- Places burden on users to police the platform
- Poor user experience for buyers encountering problematic listings
- Nearly impossible to maintain quality standards
- Significant risk of platform being used for illegal activities

### Option 3: Pre-Moderation with Clear Workflow (Chosen)
All listings must be approved by a moderator before becoming publicly visible, with defined roles, responsibilities, and timeframes.

Pros:
- Prevents harmful content from ever appearing publicly
- Maintains high quality standards across all listings
- Provides clear expectations for sellers (why listing isn't immediately visible)
- Enables proactive compliance with regulations (especially livestock)
- Builds user trust in platform safety and integrity
- Allows for specialized moderator training per domain (pet vs livestock)

Cons:
- Delay between listing creation and publication
- Requires moderator resources to keep up with volume
- More complex technical implementation (queues, status tracking)

## Decision

We will implement a **pre-moderation workflow** with the following characteristics:

1. **Listing Lifecycle States**:
   - `DRAFT`: Initial creation, editable by owner
   - `PENDING_MODERATION`: Submitted for review, not editable
   - `PUBLISHED`: Approved, visible in search and listings
   - `REJECTED`: Not approved, returned to DRAFT with moderator feedback
   - `ARCHIVED`: Manually hidden by owner or admin
   - `COMPLETED`: Transaction completed (optional user-triggered)

2. **Moderation Process**:
   - Moderators access a dedicated moderation queue
   - Queue shows listings grouped by domain (pet/livestock) with preview cards
   - For each listing, moderators verify:
     - Photo-to-listing consistency (animal matches declared breed/species)
     - Completeness of required fields
     - Compliance with platform rules (no spam, illegal content, false claims)
     - For livestock: regulatory flags indicating need for transport documentation
   - Moderator actions:
     - **Approve**: Listing status → `PUBLISHED`, becomes searchable
     - **Reject**: Listing status → `DRAFT` with moderator comments; owner can edit and resubmit

3. **Timeframe Targets**:
   - Pet listings: Target moderation < 4 hours during business hours (9:00–21:00)
   - Livestock listings: Target moderation < 6 hours during business hours (more complex validation)
   - These targets balance thoroughness with reasonable wait times

4. **Moderator Roles and Expertise**:
   - Pet moderators: Trained on companion animal characteristics, common scams in pet sales
   - Livestock moderators: Knowledgeable about farm animals, productive traits, transport regulations
   - Cross-training available but specialization encouraged for efficiency

5. **Technical Implementation**:
   - Listings API enforces that only `PUBLISHED` status appears in search/listing endpoints
   - Moderation queue API provides paginated access to `PENDING_MODERATION` listings
   - Status transitions are atomic and audited
   - Moderator actions are logged for accountability and training
   - Notifications sent to listing owners upon status changes

## Consequences

### Positive
- Eliminates harmful content from public view
- Clear, predictable process for sellers
- Enables domain-specific moderator expertise
- Platform reputation for safety and quality
- Proactive regulatory compliance (particularly important for livestock)
- Foundation for future ML-assisted moderation

### Negative
- Delay in listing visibility (mitigated by clear communication and time targets)
- Requires ongoing investment in moderator team
- Technical complexity of state management and queuing

### Neutral
- Does not affect listing creation or editing workflows in draft state
- Core listing data model unchanged (adds status field)
- Search and listing APIs unchanged except for status filtering

## Implementation Notes

1. **API Contracts**: 
   - Listings API includes `status` field with allowed values
   - Moderation endpoints for queue access and decision processing
   - WebSocket or polling mechanism for real-time status updates to owners

2. **UI Components**:
   - Moderation queue interface with filtering and bulk actions
   - Listing detail view for moderators showing all relevant information
   - Owner notification system for status changes
   - Clear indication of why a listing was rejected with actionable feedback

3. **Data Model**:
   - `listings` table includes `status` ENUM field
   - `moderation_actions` table logs all moderator decisions with timestamps and moderator ID
   - Indexes on `status` and `created_at` for efficient queue processing

4. **Business Rules**:
   - Only listing owners can transition from `DRAFT` to `PENDING_MODERATION`
   - Only moderators can transition from `PENDING_MODERATION` to `PUBLISHED` or `REJECTED`
   - Listing owners can edit and resubmit rejected listings
   - Once `PUBLISHED`, certain fields become immutable (per ADR-0004)

## Related Decisions

- **ADR-0002**: Hard split between pet and livestock marketplaces (separate moderation queues)
- **ADR-0004**: Animal-as-aggregate (listings tied to immutable animal entity)
- **ADR-0005**: No chat in MVP (contact reveal happens after moderation)

## References

- Project Brief Section 6: Moderation requirements
- Pet Marketplace Domain Specification (listing validation & moderation section)
- Livestock Marketplace Domain Specification (similar)
- Admin Domain Specification (moderation queue and roles)
- API Contracts: listings-api.yaml (status field and moderation endpoints)
