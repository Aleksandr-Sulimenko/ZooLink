# ZooLink Documentation

This directory contains the Spec-Driven Documentation (SDD) for the ZooLink project.

## Structure

```
docs/
├── README.md                 # This file - index of documentation
├── 00-project-brief.md       # High-level project context (from initiation)
│
├── 01-discovery/             # Phase 1: Discovery
│   ├── problem-statement.md  # The problem we are solving
│   ├── target-audience.md    # User personas and segments
│   ├── mvp-scope.md          # What is in and out of scope for MVP
│   ├── future-features.md    # Planned features for post-MVP
│   └── assumptions.md        # Key assumptions and limitations
│
├── 02-requirements/          # Phase 2: Requirements
│   ├── business-requirements/# Domain-specific requirements
│   │   ├── identity-domain.md
│   │   ├── animal-domain.md
│   │   ├── pet-marketplace.md
│   │   ├── livestock-marketplace.md
│   │   ├── matching-domain.md
│   │   └── admin-domain.md
│   │
│   ├── nfr/                  # Non-functional requirements
│   │   ├── security.md
│   │   ├── performance.md
│   │   └── accessibility.md
│   │
│   └── integrations.md       # External systems and services
│
├── 03-architecture/          # Phase 3: Architecture
│   ├── system-context.md     # C4 Level 1: System context
│   ├── container-diagram.md         # C4 Level 2: Containers
│   ├── domains-and-bc.md     # Bounded contexts and their interactions
│   ├── data-model.md         # Logical data model (ERD)
│   ├── api-contracts/        # API specifications (OpenAPI/YAML)
│   │   ├── auth-api.yaml
│   │   ├── animals-api.yaml
│   │   ├── listings-api.yaml
│   │   ├── matching-api.yaml
│   │   └── admin-api.yaml
│   └── storage.md            # File storage organization
│
├── 04-decisions/             # Phase 4: Architecture Decision Records
│   ├── README.md             # Index of ADRs
│   ├── 0001-tech-stack.md    # Choice of NestJS, PostgreSQL, React, etc.
│   ├── 0002-hard-split-markets.md # Why we separate pet and livestock markets
│   ├── 0003-pre-moderation-workflow.md # How pre-moderation works
│   ├── 0004-animal-as-aggregate.md # Why animal is a separate aggregate root
│   ├── 0005-no-chat-mvp.md   # Why chat is deferred to Phase 2
│   └── template.md           # Template for new ADRs
│
├── 05-ui-ux/                 # Phase 5: UI/UX Specifications
│   ├── user-flows.md         # Key user journeys
│   └── wireframes/           # Links to Figma or sketches
│
└── 06-operations/            # Phase 6: Operations
    ├── deployment.md         # How we deploy and release
    └── monitoring.md         # What we monitor and alert on
```

## How to Use This Documentation

1. **Start with the Problem Statement**: Understand why we are building ZooLink.
2. **Review the Project Brief**: Context from the initiation phase.
3. **Examine the MVP Scope**: Know exactly what we are building in the first release.
4. **Dive into Domain Requirements**: Understand the details of each bounded context.
5. **Review Non-Functional Requirements**: Security, performance, accessibility constraints.
6. **Study the Architecture**: See how the system is structured and how components interact.
7. **Review Architecture Decisions**: Understand the trade-offs made.
8. **Look at UI/UX and Operations**: For design and deployment details.

## Conventions

- All documents are written in Markdown.
- Diagrams use Mermaid syntax where appropriate.
- API contracts are in OpenAPI 3.0 YAML format.
- Terms are defined consistently across documents.

## Status

This documentation is a living artifact and will be updated as the project progresses.

*Last updated: [Date]*