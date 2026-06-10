# Procedure: Generate Definition of Done (DoD) Section

## Purpose
Create a standardized Definition of Done section for specification documents that defines clear completion criteria aligned with SDD principles.

## When to Use
This procedure should be used when creating or updating any specification document in the ZooLink project to ensure each artifact has explicit completion criteria.

## Inputs
- Specification document type (domain spec, business requirement, API contract, etc.)
- Key components that must be complete for the artifact to be considered "done"
- Any domain-specific completion requirements
- References to related artifacts that must exist or be updated

## Outputs
- Definition of Done section ready for inclusion in specification documents
- Clear criteria for when the artifact can be used as a foundation for subsequent work

## Procedure Steps

### Step 1: Determine Artifact Type and Purpose
Identify what type of artifact you are defining DoD for:
- Domain Specification (e.g., animal-domain.md, pet-marketplace-domain.md)
- Business Requirements (e.g., animal-domain.md in business-requirements/)
- API Contract (YAML files in api-contracts/)
- Architecture Decision Record (ADR)
- Non-Functional Requirement document
- Testing Strategy or other process document

### Step 2: Identify Core Completion Requirements
Based on the artifact type, determine what must be present for it to be considered complete:

**For Domain Specifications:**
- [ ] Clear Outcome statement
- [ ] Well-defined Scope & Boundaries
- [ ] Constraints section covering legal, security, performance, etc.
- [ ] Prior Decisions documented
- [ ] NFR Traceability section with proper references
- [ ] Task Breakdown covering implementation aspects
- [ ] Verification Criteria with testable items
- [ ] Consistency with related domain models and API contracts

**For Business Requirements:**
- [ ] Clear Purpose statement
- [ ] Core Concepts defined
- [ ] Business Rules with clear enforcement mechanisms
- [ ] Data Model (if applicable)
- [ ] Validation Rules that are implementable and testable
- [ ] User Journeys or sequence diagrams where appropriate
- [ ] Non-Functional Requirements specific to the domain
- [ ] Open Questions & Assumptions clearly documented
- [ ] Consistency with domain specifications

**For API Contracts:**
- [ ] Valid OpenAPI/YAML format
- [ ] Complete path definitions for all endpoints
- [ ] Proper HTTP methods and status codes
- [ ] Request/response schemas with required fields marked
- [ ] Security schemes defined where applicable
- [ ] Examples provided for complex operations
- [ ] Consistency with domain model fields
- [ ] Referenced from relevant specifications

**For General Artifacts:**
- [ ] Clear purpose and outcome statement
- [ ] Complete coverage of the intended topic
- [ ] Consistency with related artifacts
- [ ] Actionable content for stakeholders
- [ ] Proper formatting and structure
- [ ] Reviewed for terminology consistency

### Step 3: Add SDD-Specific Requirements
Include these SDD-mandatory elements in every DoD:
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented
- [ ] GAP Registry: All significant uncertainties are documented as GAP entries with owners and resolution targets
- [ ] Terminology Consistency: All terms used are consistent with project glossary and other specifications
- [ ] Human-in-the-loop: Points requiring expert judgment are identified for developer/architect review

### Step 4: Format the DoD Section
Create the section using this format:

```
## Definition of DoD
This [artifact type] is considered complete when:
- [ ] [Specific completion criterion 1]
- [ ] [Specific completion criterion 2]
- [ ] [Specific completion criterion 3]
- [ ] [Continue with all criteria...]
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented
- [ ] GAP Registry: All significant uncertainties are documented as GAP entries with owners and resolution targets
- [ ] Terminology Consistency: All terms used are consistent with project glossary and other specifications
```

### Step 5: Add to Specification Document
Place the DoD section appropriately in the document, typically:
- After the Verification Criteria section in specifications
- Or as a standalone section that complements existing completion criteria

## Quality Checks
Before considering this procedure complete:
- [ ] Criteria are specific, measurable, and actionable
- [ ] Criteria cover all essential aspects of the artifact
- [ ] SDD-specific requirements (NFR traceability, GAP registry, terminology consistency) are included
- [ ] Language is consistent with the rest of the document (English/Russian)
- [ ] Checkbox formatting is correct for Markdown
- [ ] Criteria don't duplicate existing verification criteria unnecessarily
- [ ] For Russian docs, use appropriate terminology while keeping structure consistent

## Example Output
For an animal domain specification:

```
## Definition of DoD
This domain specification is considered complete when:
- [ ] Outcome statement clearly defines the domain's purpose and boundaries
- [ ] Scope & Boundaries section distinguishes what is in and out of scope
- [ ] Constraints cover legal (152-ФЗ, veterinary regulations), security, performance, and usability aspects
- [ ] Prior Decisions document key architectural choices made
- [ ] NFR Traceability section links to performance, security, and accessibility requirements
- [ ] Task Breakdown covers backend, frontend, and infrastructure implementation aspects
- [ ] Verification Criteria includes unit, integration, E2E, manual, performance, compliance, and documentation checks
- [ ] Data Model section completely describes all attributes with types and constraints
- [ ] Validation Rules are specific, testable, and implementation-guiding
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented
- [ ] GAP Registry: All significant uncertainties are documented as GAP entries with owners and resolution targets
- [ ] Terminology Consistency: All terms used are consistent with project glossary and other specifications
```

## Notes
- DoD should evolve as the artifact matures - early drafts might have more aspirational criteria
- During reviews, use the DoD as a checklist to determine if the artifact is ready to proceed
- Consider linking DoD criteria to specific verification activities or testing requirements
- In Russian documentation, translate the criteria while maintaining the structure and SDD requirements
- The DoD serves as a contract between specification producers and consumers (developers, testers, etc.)