# Procedure: AI Agent Interaction Protocol

## Purpose
Create a standardized procedure for AI agent interaction following Spec-Driven Documentation (SDD) principles to ensure predictable, verifiable, and human-in-the-loop assisted documentation work.

## When to Use
This procedure should be used when:
- An AI agent is tasked with creating, updating, or reviewing documentation
- Following SDD principles for structured, stage-based work
- Ensuring human expertise is applied where judgment is required
- Maintaining consistency and traceability in AI-assisted documentation

## Inputs
- Current documentation artifact being worked on
- Understanding of SDD principles and artifact types
- Access to project skills (NFR traceability, GAP registry, DoD generation)
- Clear task definition aligned with SDD stage progression

## Outputs
- AI agent interaction procedure documentation
- Clear checkpoints for human-in-the-loop review
- Standardized approach for uncertainty handling
- Verifiable output format

## Procedure Steps

### Step 1: Identify the Current SDD Stage
Determine which stage of the SDD lifecycle you're working in:
- **Domain (D)**: Glossary, definitions, boundaries, key concepts
- **Requirements (R)**: What should be achieved, constraints, acceptance criteria
- **Scenarios (S)**: Observable behavior, processes, user interactions
- **Models/Data (M)**: Data structures, contracts, schemas, dictionaries
- **Architecture (A)**: Component breakdown, interfaces, ADRs
- **Verification (T)**: Tests, validation procedures, quality checks

### Step 2: Apply Stage-Appropriate Procedures
Based on the identified stage, apply the corresponding standardized procedure:

**For Domain Work:**
- Focus on terminology consistency and boundary definitions
- Use existing glossaries as single source of truth
- Flag ambiguities as GAP entries rather than resolving them
- Reference: gap-registry-generator.md

**For Requirements Work:**
- Ensure requirements are testable and traceable
- Link to NFRs using nfr-traceability-generator.md
- Document assumptions as GAP entries
- Reference: nfr-traceability-generator.md

**For Scenario Work:**
- Translate requirements into observable behavior
- Ensure scenarios have verification paths
- Link to data models and architecture where applicable
- Flag undefined behaviors as GAP entries

**For Model/Data Work:**
- Define clear data structures with types and constraints
- Ensure consistency with requirements and scenarios
- Reference existing domain definitions
- Flag incomplete mappings as GAP entries

**For Architecture Work:**
- Document component interactions and interfaces
- Record significant decisions as ADRs
- Ensure traceability to requirements and scenarios
- Flag unresolved architectural questions as GAP entries

**For Verification Work:**
- Define clear acceptance criteria and test procedures
- Link verification to specific requirements
- Ensure coverage of NFRs
- Flag untestable requirements as GAP entries

### Step 3: Implement Human-in-the-Loop Checkpoints
Trigger mandatory human review when:
- **Source Contradiction**: Conflicting information from different sources
- **Requirement Ambiguity**: Unclear or conflicting requirements affecting scope/acceptance
- **Architectural Significance**: Decisions with major system implications
- **Terminological Conflict**: Inconsistent use of key terms
- **NFR Coverage Questions**: Uncertainty about performance/security/accessibility coverage

### Step 4: Handle Uncertainty Explicitly
When encountering uncertainty:
1. Do NOT guess or assume
2. Create a GAP entry using gap-registry-generator.md
3. Clearly state what is unknown and why it matters
4. Specify what information would resolve it
5. Assign ownership and target resolution
6. Continue work noting the limitation

### Step 5: Generate Verification Artifacts
For completed work:
1. Create traceability links (NFR, GAP, terminology)
2. Generate Definition of Done section using dod-generator.md
3. Ensure all SDD-mandatory elements are present:
   - NFR Traceability section
   - GAP Registry documentation
   - Terminology consistency check
   - Human-in-the-loop acknowledgment
4. Format output according to specification standards

### Step 6: Request Human Review
When work is complete or at a checkpoint:
1. Clearly articulate what was done
2. Specify what requires human judgment
3. Present GAP entries needing resolution
4. Show traceability links created
5. Request explicit approval or feedback

## Quality Checks
Before considering this procedure complete:
- [ ] SDD stage correctly identified and appropriate procedures applied
- [ ] All uncertainties documented as GAP entries (no guessing)
- [ ] Human-in-the-loop triggers identified and respected
- [ ] Terminological consistency verified against project glossary
- [ ] NFR traceability links created where applicable
- [ ] Output follows specification formatting standards
- [ ] Clear request for human review included when required
- [ ] For Russian docs, procedure terminology translated appropriately

## Example Output
For an AI agent working on requirements specification:

```
## SDD Stage: Requirements (R)
Applied nfr-traceability-generator.md to create NFR traceability section.
Applied gap-registry-generator.md to document 2 open questions about API rate limits.
Terminology verified against project glossary - 0 inconsistencies found.
Human-in-the-loop required for: API versioning strategy decision.
Ready for human review of requirements completeness and NFR coverage.

## Definition of DoD
This requirements specification is considered complete when:
- [ ] Clear Purpose statement
- [ ] Core Concepts defined
- [ ] Business Rules with clear enforcement mechanisms
- [ ] Data Model (if applicable)
- [ ] Validation Rules that are implementable and testable
- [ ] User Journeys or sequence diagrams where appropriate
- [ ] Non-Functional Requirements specific to the domain
- [ ] Open Questions & Assumptions clearly documented as GAP entries
- [ ] Consistency with domain specifications
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented
- [ ] GAP Registry: All significant uncertainties are documented as GAP entries with owners and resolution targets
- [ ] Terminology Consistency: All terms used are consistent with project glossary and other specifications
```

## Notes
- This procedure operationalizes the "human-in-the-loop" principle from SDD
- AI agents should view themselves as procedure followers, not decision makers
- The goal is predictability and verifiability, not autonomous creativity
- Regularly update this procedure as SDD practices evolve in the project
- Link to other skills (nfr, gap, dod) rather than duplicating their logic