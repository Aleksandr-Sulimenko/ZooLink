# Procedure: Generate NFR Traceability Section

## Purpose
Create a standardized Non-Functional Requirements (NFR) traceability section for specification documents that links to the appropriate NFR documents and includes verification criteria.

## When to Use
This procedure should be used when creating or updating any specification document in the ZooLink project to ensure consistent NFR traceability.

## Inputs
- Specification document being worked on
- Access to NFR documents: performance.md, security.md, accessibility.md
- Understanding of which NFRs are relevant to the specific domain/specification

## Outputs
- NFR Traceability section ready for inclusion in specification documents
- Corresponding verification criteria item

## Procedure Steps

### Step 1: Identify Relevant NFRs
Determine which of the three main NFR categories apply to the specification:
- **Performance (NFR-PERF)**: Almost always applicable - relates to response times, throughput, scalability
- **Security (NFR-SEC)**: Applicable when the spec involves data handling, authentication, authorization, or user privacy
- **Accessibility (NFR-ACC)**: Applicable when the spec involves user interfaces, frontend components, or user interactions

### Step 2: Locate Reference Documents
Verify the existence and correct paths of NFR documents:
- Performance: `docs/02-requirements/nfr/performance.md`
- Security: `docs/02-requirements/nfr/security.md`
- Accessibility: `docs/02-requirements/nfr/accessibility.md`

### Step 3: Generate NFR Traceability Section
Create the section using this exact format:

```
## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: [Specific performance requirement statement] (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: [Specific security requirement statement] (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: [Specific accessibility requirement statement] (see docs/02-requirements/nfr/accessibility.md)
```

Where the bracketed text should be replaced with a concise, specific statement about how the specification addresses that NFR, based on the content of the specification.

### Step 4: Add Verification Criteria Item
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