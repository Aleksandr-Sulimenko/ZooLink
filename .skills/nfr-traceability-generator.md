# Procedure: Generate NFR Traceability Section

## Purpose
Create a standardized Non-Functional Requirements (NFR) traceability section for specification documents that links to the appropriate NFR documents and includes verification criteria, following Spec-Driven Documentation (SDD) principles.

## When to Use
This procedure should be used when creating or updating any specification document in the ZooLink project to ensure consistent NFR traceability, particularly during the Requirements (R) stage of the SDD lifecycle.

## Inputs
- Specification document being worked on (should be in Requirements stage)
- Access to NFR documents: performance.md, security.md, accessibility.md
- Understanding of which NFRs are relevant to the specific domain/specification
- Current SDD stage confirmation (should be Requirements/R stage)

## Outputs
- NFR Traceability section ready for inclusion in specification documents
- Corresponding verification criteria item
- Documentation of NFR traceability for human-in-the-loop review

## Procedure Steps

### Step 1: Confirm SDD Stage
Verify that you are working on a Requirements (R) specification:
- This procedure is specifically for Requirements stage work
- If working on other stages (Domain, Scenarios, Models/Data, Architecture, Verification), adapt accordingly
- NFR traceability is most relevant to Requirements stage but may be referenced in other stages

### Step 2: Identify Relevant NFRs
Determine which of the three main NFR categories apply to the specification:
- **Performance (NFR-PERF)**: Almost always applicable - relates to response times, throughput, scalability
- **Security (NFR-SEC)**: Applicable when the spec involves data handling, authentication, authorization, or user privacy
- **Accessibility (NFR-ACC)**: Applicable when the spec involves user interfaces, frontend components, or user interactions

### Step 3: Locate Reference Documents
Verify the existence and correct paths of NFR documents:
- Performance: `docs/02-requirements/nfr/performance.md`
- Security: `docs/02-requirements/nfr/security.md`
- Accessibility: `docs/02-requirements/nfr/accessibility.md`

### Step 4: Generate NFR Traceability Section
Create the section using this exact format:

```
## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: [Specific performance requirement statement] (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: [Specific security requirement statement] (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: [Specific accessibility requirement statement] (see docs/02-requirements/nfr/accessibility.md)
```

Where the bracketed text should be replaced with a concise, specific statement about how the specification addresses that NFR, based on the content of the specification.

### Step 5: Add Human-in-the-Loop Checkpoint
Before finalizing, trigger human review for:
- **NFR Coverage Questions**: Uncertainty about whether all relevant NFRs are addressed
- **Requirement Ambiguity**: Unclear or conflicting requirements affecting NFR interpretation
- **Source Contradiction**: Conflicting information from different sources about NFR applicability

### Step 6: Add Verification Criteria Item
Add this exact item to the Verification Criteria section of the specification:
```
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented
```

## Quality Checks
Before considering this procedure complete:
- [ ] All three NFR categories are addressed (even if the statement notes limited applicability)
- [ ] References point to correct document paths
- [ ] Statements are specific to the specification content, not generic
- [ ] Verification criteria item uses exact wording
- [ ] Section follows the exact markdown formatting shown above
- [ ] Russian equivalent uses correct terminology when applicable
- [ ] Human-in-the-loop review triggered for NFR coverage questions
- [ ] SDD stage confirmation completed (Requirements/R stage)

## Example Output
For a specification dealing with user authentication:

```
## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Authentication latency < 1s under normal load; auth API latency < 800ms for 95% of requests under load test (100 RPS) (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Passwords not used; authentication via phone/OAuth only; protect against brute force, SIM swapping; data storage adheres to 152-ФЗ (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Registration flow must be simple for non-technical users (mass market pet owners); follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)
```

## Notes
- If an NFR category is genuinely not applicable, still include it with a brief explanation why (e.g., "Not applicable - this specification deals purely with backend data structures with no user interface components")
- Always verify that the referenced NFR documents exist and contain relevant information
- When updating existing specs, ensure consistency with the exact format specified
- This procedure operationalizes SDD principles by ensuring traceability between requirements and NFRs
- Human-in-the-loop review is required for NFR coverage determination to ensure expert judgment is applied