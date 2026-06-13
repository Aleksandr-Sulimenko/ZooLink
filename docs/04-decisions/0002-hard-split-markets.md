# ADR-0002: Hard Split Between Pet and Livestock Marketplaces

**Status**: Accepted  
**Date**: 2026-05-28  

## Context and Problem Statement

The ZooLink platform needs to serve two distinct market segments with fundamentally different requirements:
- Pet market: companion animals (dogs, cats, birds, rabbits, reptiles, etc.) focused on temperament, health for home environment
- Livestock market: farm animals (cattle, horses, sheep, goats, pigs, poultry, etc.) focused on productive traits, genetics, and commercial value

Initially, we considered a unified marketplace approach where all animals could be listed in a single interface with conditional fields based on animal type. However, analysis revealed significant differences that would compromise user experience and platform integrity if handled through conditional UI alone.

## Decision Drivers

1. **User Experience**: Pet owners and livestock farmers have different mental models, terminologies, and priorities
2. **Validation Rules**: Different attribute requirements, validation logic, and business rules
3. **Search and Discovery**: Different search facets and filtering needs
4. **Legal/Regulatory**: Different compliance requirements (especially for livestock movement tracking)
5. **Moderation**: Different moderation focus areas and expertise needed
6. **Future Extensibility**: Different evolution paths for each market segment

## Considered Options

### Option 1: Unified Marketplace with Conditional Fields
Single listing interface that shows/hides fields based on animal type (pet vs livestock).

Pros:
- Simpler technical implementation initially
- Single codebase for listing creation/editing
- Shared moderation interface

Cons:
- Confusing user experience with irrelevant fields shown/hidden
- Complex conditional validation logic
- Difficult to maintain as requirements diverge
- Poor search/facet experience (mixing incompatible filters)
- Moderators would need expertise in both domains
- Harder to evolve each segment independently

### Option 2: Completely Separate Marketplaces (Chosen)
Separate user interfaces, data validation, search APIs, and moderation queues for pet and livestock markets, while sharing core components (authentication, animal entity, user management, etc.).

Pros:
- Clear, focused user experience for each segment
- Separate validation logic and business rules
- Optimized search/faceting for each domain
- Specialized moderation workflows
- Independent evolution and scaling
- Clear separation of concerns in codebase
- Better performance (smaller, focused APIs)

Cons:
- Slightly more initial development effort
- Need to maintain shared components carefully
- Duplication of some UI patterns (mitigated by shared component library)

## Decision

We will implement a **hard split between pet and livestock marketplaces** with:
- Separate entry points in the UI (different sections/tabs)
- Distinct listing creation and management flows
- Domain-specific validation rules and business logic
- Independent search APIs with domain-appropriate filtering
- Separate moderation queues and workflows
- Shared core components: authentication, animal entity, user profiles, organization structures, notification systems

This approach aligns with Domain-Driven Design principles by treating pet and livestock as distinct bounded contexts with their own ubiquitous language, while sharing the kernel (user identity, core animal entity, etc.).

## Consequences

### Positive
- Users experience a clear, focused interface relevant to their needs
- Development teams can work independently on each marketplace
- Easier to implement domain-specific features without affecting the other segment
- Clear moderation paths reduce cognitive load for moderators
- Better search relevance and performance
- Simpler validation and business logic implementation

### Negative
- Initial development effort increased by ~15-20%
- Need for careful management of truly shared components
- Slight increase in architectural complexity

### Neutral
- Data model remains unified (animal entity serves both domains)
- Authentication and user management remain shared
- Core infrastructure (database, caching, storage) remains shared

## Implementation Notes

1. **Routing**: Separate top-level routes for `/pets` and `/livestock` sections
2. **APIs**: Separate API namespaces or clear domain separation in shared APIs
3. **UI Components**: Shared component library for common elements (buttons, forms, modals) but domain-specific pages and workflows
4. **Validation**: Separate validation rule sets enforced at API boundaries
5. **Moderation**: Separate moderation interfaces with domain-specific checklists and training requirements
6. **Search**: Separate search endpoints with domain-tailored filtering and faceting
7. **Analytics**: Separate metrics dashboards with domain-specific KPIs

## Related Decisions

- **ADR-0004**: Animal-as-aggregate (reinforces that Animal entity is shared kernel)
- **ADR-0001**: Tech stack choice (enables modular implementation)

## References

- Project Brief Section 2: Domain Breakdown
- Project Brief Section 7: Separating Pets and Livestock
- Animal Domain Specification
- Pet Marketplace Domain Specification  
- Livestock Marketplace Domain Specification
