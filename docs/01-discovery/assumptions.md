# Assumptions and Limitations: ZooLink

## Purpose
Documents key assumptions made during planning and known limitations that affect the MVP scope and design. These assumptions are reviewed regularly and may change as the project progresses.

## Core Assumptions

### Market & User Behavior
1. **Network Effect Validity**: 
   - Assumption: There is sufficient latent demand for a trusted marketplace connecting animal owners that will exhibit network effects once critical mass is reached.
   - Basis: Fragmentation of existing solutions (Avito, social media groups, breed club forums) and pain points expressed in user interviews.
   - Validation Metric: Month-over-month growth in active listings and user retention.

2. **User Motivation**:
   - Assumption: Users are motivated to participate primarily by reduced transaction friction and increased trust, not immediate financial gain.
   - Basis: Successful models in other regulated markets (real estate, professional services) where trust reduces search costs.
   - Validation Metric: User survey responses citing trust and time savings as primary benefits.

3. **Moderator Availability**:
   - Assumption: Sufficient volunteer or low-cost moderators will be available during MVP to handle expected volume (<50 listings/day).
   - Basis: Community moderation models in niche hobbyist platforms and breed clubs.
   - Contingency: If volume exceeds capacity, implement daily submission limits or prioritize by user tenure.

4. **Geographic Concentration**:
   - Assumption: Initial user base will be geographically concentrated enough to make local search (radius-based) effective.
   - Basis: Early adopter targeting through breed clubs, agricultural cooperatives, and vet clinic partnerships.
   - Validation Metric: Percentage of successful transactions occurring within 50km radius.

### Technical Feasibility
5. **Third-party Service Availability**:
   - Assumption: Key third-party services (SMS gateway, OAuth providers, mapping) will remain available with free/mvp tiers sufficient for validation.
   - Basis: Current offerings from Twilio, Google/FB/Apple/TG/VK, and Yandex/Maps.
   - Monitoring: Monthly review of service limits and costs.

6. **Technology Stack Suitability**:
   - Assumption: Selected stack (NestJS/PostgreSQL/React) can handle MVP load and provides clear path to scaling.
   - Basis: Benchmarks and case studies of similar applications using this stack.
   - Validation: Load testing results against defined performance targets.

7. **Data Quality**:
   - Assumption: Users will provide sufficiently accurate data for core functionality (species, breed, location, photos).
   - Basis: Successful user-generated content models in marketplaces (Etsy, eBay) with light moderation.
   - Mitigation: Moderator spot-checks and user reporting mechanisms.

8. **File Storage Costs**:
   - Assumption: Storage costs for listing photos will remain manageable during MVP (<50GB/month).
   - Basis: Estimated 500 listings * 3 photos/listing * 2MB/photo average.
   - Monitoring: Monthly storage usage reports.

### Business & Operational
9. **Regulatory Timeline**:
   - Assumption: Regulatory compliance (Меркурий/ВетИС integration) is not required for MVP validation.
   - Basis: Focus on companion animals initially; livestock features can delay regulatory work.
   - Validation: Legal review confirming no immediate regulatory obstacles for pet-focused MVP.

10. **Payment Processing Delay**:
    - Assumption: Monetization can be delayed until Facза 2 without compromising validation.
    - Basis: Successful marketplaces that delayed monetization (early Facebook, Twitter, Reddit).
    - Validation: Clear path to monetization identified in future-features.md.

11. **Moderation Effectiveness**:
    - Assumption: Human moderation at expected volume will maintain adequate content quality.
    - Basis: Success of platforms like Product Hunt, Dribbble with similar moderation models.
    - Validation: Moderation accuracy metrics (appeal rate, user satisfaction).

12. **User Support Capacity**:
    - Assumption: User support needs during MVP can be handled via FAQ, email, and community self-help.
    - Basis: Low expected complexity of core product interactions.
    - Monitoring: Support ticket volume and resolution time.

## Known Limitations & Mitigations

### Technical Limitations
1. **Real-time Features**:
   - Limitation: Real-time chat and notifications deferred to Facза 2.
   - Mitigation: Contact reveal mechanism provides asynchronous communication path.
   - Future: WebSocket implementation planned for Facза 2.

2. **Advanced Search**:
   - Limitation: No fuzzy search, phonetic matching, or image-based search on MVP.
   - Mitigation: Standard text filtering with exact/partial matches and geo-radius.
   - Future: Elasticsearch integration and computer vision for Facза 2+.

3. **Data Portability**:
   - Limitation: No data import/export tools for users on MVP.
   - Mitigation: Manual data entry sufficient for early adopters.
   - Future: CSV import/export and API access planned for Facза 2.

4. **Offline Capabilities**:
   - Limitation: Basic PWA caching only; no offline listing creation/modification.
   - Mitigation: Clear indication of online/offline status and queueing of actions.
   - Future: Advanced service worker strategies for Facза 2.

### Business Limitations
1. **Geographic Bias**:
   - Limitation: Initial user acquisition may favor urban/suburban areas.
   - Mitigation: Targeted outreach to rural communities and agricultural cooperatives.
   - Monitoring: Geographic distribution of users and listings.

2. **Species Bias**:
   - Limitation: Early adoption may favor common pets (dogs, cats) over livestock or exotic species.
   - Mitigation: Breed-specific outreach and partnerships with specialty clubs.
   - Monitoring: Distribution of listings by species and breed.

3. **Moderator Burnout**:
   - Limitation: Volunteer moderators may experience fatigue if volume grows unexpectedly.
   - Mitigation: Clear moderation guidelines, rotation systems, and recognition.
   - Future: Moderator incentives and potential paid moderation in Facза 2.

4. **Trust Bootstrap**:
   - Limitation: Initial lack of transaction history makes trust establishment challenging.
   - Mitigation: Emphasis on verification badges, detailed profiles, and community signals.
   - Future: Reputation system and transaction history in Facза 2.

### Regulatory Limitations
1. **Animal Welfare Regulations**:
   - Limitation: Platform does not enforce animal welfare standards beyond basic moderation.
   - Mitigation: Moderator training to spot obvious welfare concerns and user reporting.
   - Future: Partnerships with welfare organizations and educational content.

2. **Transport Regulations**:
   - Limitation: Users responsible for compliance with animal transport regulations.
   - Mitigation: Disclaimers and resource links in listing creation flow.
   - Future: Integration with transport logistics providers in Facза 3.

3. **Breeding Regulations**:
   - Limitation: Platform does not verify breeding licenses or permits where required.
   - Mitigation: Clear disclaimers that users must comply with local regulations.
   - Future: Optional verification fields for licenses/certificates in Facза 2.

## Assumption Review Schedule
- **Bi-weekly**: Review during team retrospectives (assumption validity, new evidence)
- **Monthly**: Formal assumption review with stakeholders
- **Trigger-based**: Immediately review if key metric deviates significantly from expectation
- **Pre-phase**: Comprehensive review before entering new development phase

## Change Control Process
If an assumption is invalidated:
1. Document the invalidating evidence
2. Assess impact on scope, timeline, and architecture
3. Propose mitigation or pivot via Change Request
4. Update this document and related artifacts
5. Re-establish validation metrics if needed

---
*This document is a living artifact. Last reviewed: [Date]. Next review: [Date + 2 weeks].