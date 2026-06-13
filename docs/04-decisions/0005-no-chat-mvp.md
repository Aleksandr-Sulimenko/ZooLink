# ADR-0005: No In-App Chat in MVP

**Status**: Accepted  
**Date**: 2026-05-31  

## Context and Problem Statement

The ZooLink platform needs to facilitate communication between buyers and sellers after they discover a listing of interest. Initially, we considered implementing in-app chat functionality as part of the MVP to enable real-time negotiation, questions, and arrangements.

However, analysis revealed several concerns about implementing chat in the MVP that would increase complexity, introduce moderation challenges, and potentially delay core marketplace functionality. We needed to determine whether chat is essential for the MVP or can be deferred to a later phase while still providing a viable user experience for completing transactions.

## Decision Drivers

1. **Core Value Proposition**: The primary value is connecting buyers and sellers through listings; communication is secondary to discovery
2. **Moderation Burden**: Real-time chat requires active monitoring to prevent harassment, scams, and inappropriate content
3. **Development Complexity**: Chat implementation involves WebSockets, message persistence, notifications, and UI components
4. **User Safety**: Chat opens avenues for grooming, fraud, and other safety concerns requiring robust moderation
5. **Technical Dependencies**: Chat may require additional infrastructure (message broker, presence servers)
6. **Alternative Communication Channels**: Users can exchange contact information to communicate externally
7. **Learning Value**: Observing how users communicate externally can inform future chat implementation
8. **Scope Focus**: MVP should validate core marketplace concepts before adding communication features

## Considered Options

### Option 1: In-App Chat in MVP
Implement real-time chat functionality within the platform as part of the initial release.

Pros:
- Seamless user experience without leaving the app
- All communication tracked within platform (potential for analytics)
- Immediate notifications and responses
- Modern expectation for marketplace applications

Cons:
- Significant development effort delaying core marketplace features
- Increased moderation complexity and cost
- Potential for platform to be used for harassment or illegal activities
- Requires real-time infrastructure (WebSocket servers, message broker)
- Need for chat-specific UI components and notification systems
- Diverts focus from validating core listing discovery and transaction flow

### Option 2: Deferred Chat with Contact Sharing (Chosen)
Postpone in-app chat to a future phase; instead, share verified contact information after listings are published.

Pros:
- Focuses development on core marketplace functionality (listings, search, moderation)
- Eliminates chat-related moderation burden in MVP
- Simpler technical implementation (no real-time messaging infrastructure)
- Users can still communicate via preferred external channels (phone, Telegram, VK)
- Contact sharing creates natural incentive for users to complete listings (to get contact info)
- Provides opportunity to study actual communication patterns before building chat
- Faster time-to-market for core value proposition

Cons:
- Requires users to switch apps to communicate
- No communication history retained within platform
- Less seamless experience than in-app chat
- Potential for users to share false contact information (mitigated by verification)

### Option 3: Delayed Contact Sharing (Alternative Considered)
Only show contact information after transaction is marked as completed by both parties.

Pros:
- Maximum assurance that communication leads to genuine transactions
- Reduces wasted communication for unsuccessful inquiries

Cons:
- Creates chicken-and-egg problem: users need to communicate to complete transaction
- Significantly degrades user experience for legitimate inquiries
- Discourages platform use if users can't contact sellers easily
- Difficult to verify completion without external confirmation

## Decision

We will **defer in-app chat to a future phase (Phase 2 or later)** and implement a **contact sharing mechanism** in the MVP where:

1. **Contact Information Sharing**:
   - After a listing reaches `PUBLISHED` status, interested users can request to see contact information
   - Clicking "Show Contacts" reveals the owner's phone number and links to Telegram/VK profiles (if provided and authorized)
   - Exact address is never disclosed for safety and privacy reasons
   - System logs contact requests for analytics and safety monitoring

2. **Contact Information Management**:
   - Users can optionally provide Telegram and VK usernames during profile setup
   - Phone number is required for registration (verified via SMS) and can be shown in contacts
   - Email collection is optional and not shown in contacts (used for notifications only)
   - Users can choose which contact methods to share (phone, Telegram, VK, any combination)

3. **Privacy and Safety Measures**:
   - No exact address sharing under any circumstances
   - Contact information only revealed for `PUBLISHED` listings (after moderation)
   - Logging of who requested contact information for which listing and when
   - Rate limiting on contact requests to prevent harvesting
   - Ability for users to block others from seeing their contact information

4. **User Flow**:
   - User finds listing of interest in search results
   - Views listing details (description, photos, price, etc.)
   - Clicks "Show Contacts" button
   - System verifies listing is `PUBLISHED` and logs the request
   - Shows available contact information (phone, Telegram/VK links as authorized by owner)
   - User initiates contact outside the platform via their preferred method

## Consequences

### Positive
- Accelerates delivery of core marketplace functionality
- Eliminates significant moderation burden associated with real-time chat
- Simpler technical implementation and infrastructure requirements
- Focuses MVP on validating listing discovery, moderation, and transaction intent
- Provides safe, controlled mechanism for off-platform communication
- Enables observation of actual communication patterns to inform future chat design
- Reduces scope creep and improves chances of successful MVP launch

### Negative
- Users must switch applications to communicate
- No communication history retained within the platform
- Less integrated experience compared to in-app chat
- Requires user education about why contact sharing works this way

### Neutral
- Does not prevent adding chat in future phases (architecture designed for extensibility)
- Core data model unchanged (adds optional social media fields to user profile)
- Contact sharing can be evolved toward chat incrementally (e.g., starting with message forwarding)

## Implementation Notes

1. **Data Model**:
   - `users` table includes optional `telegram_username`, `vk_username` fields
   - `phone_number` stored as hash (`phone_hash`) for verification, original not retained
   - `contact_sharing_preferences` JSONB field to control what gets shown
   - `contact_requests` table logs: requester_id, listing_id, timestamp, contact_method_shown

2. **API Design**:
   - Profile endpoints to set/update contact information and sharing preferences
   - Listing detail endpoint includes logic to conditionally show contact fields based on status and permissions
   - Contact request logging endpoint (called when "Show Contacts" clicked)
   - Rate limiting middleware on contact request endpoints

3. **UI Components**:
   - "Show Contacts" button on listing detail page (visible only for `PUBLISHED` listings)
   - Modal or expanded section showing available contact information
   - Icons/link handlers for phone (tel:) and Telegram/VK (deep links or universal links)
   - Clear indication that exact address is never shared
   - Profile settings to manage which contact methods to share

4. **Business Rules**:
   - Contact information only shown for listings with status `PUBLISHED`
   - Users must be authenticated to request contact information (prevents scraping)
   - Owners can modify contact sharing preferences at any time (affects future requests)
   - System tracks contact requests but does not store the actual communication content
   - Owners can block specific users from seeing their contact information (via reporting/blocking system)

## Related Decisions

- **ADR-0003**: Pre-Moderation Workflow (contact sharing only after moderation)
- **ADR-0004**: Animal-as-aggregate (listings tied to verified animal and owner)
- **ADR-0002**: Hard split markets (contact sharing works consistently across both domains)
- **ADR-0001**: Tech stack choice (NestJS supports real-time features via WebSockets for future chat)

## References

- Project Brief Section 4: Chat deferred to phase 2; contact sharing instead
- Project Brief Section 15: GPS coordinates not shared; only approximate distance
- Identity Domain Specification (profile management, optional social media fields)
- Pet Marketplace Domain Specification (post-moderation interaction section)
- Livestock Marketplace Domain Specification (similar)
- Matching Domain Specification (contact initiation path)
- API Contracts: identity-api.yaml (profile endpoints), listings-api.yaml (contact logic)
- Non-Functional Requirements: security.md (PII minimization, rate limiting)
