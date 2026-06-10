# Procedure: Generate GAP Registry Entry

## Purpose
Create a standardized GAP (uncertainty) registry entry for tracking unknowns, assumptions, and open questions in the ZooLink project documentation following Spec-Driven Documentation (SDD) principles.

## When to Use
This procedure should be used when documenting assumptions, open questions, or uncertainties that need to be tracked and resolved during the project lifecycle, particularly during the Requirements (R) and Domain (D) stages of the SDD lifecycle.

## Inputs
- Description of the uncertainty/assumption/open question
- Assessment of criticality (High/Medium/Low)
- Potential options or approaches being considered
- Stakeholder/responsible party for resolution
- Target resolution phase or timeline
- Current SDD stage confirmation (helps determine appropriateness)

## Outputs
- GAP registry entry ready for inclusion in specification or requirements documents
- Updated GAP registry table if one exists
- Documentation of uncertainty for human-in-the-loop review

## Procedure Steps

### Step 1: Confirm SDD Stage Appropriateness
GAP entries are most appropriate during:
- **Domain (D)** stage: When defining terms, boundaries, and key concepts where uncertainties exist
- **Requirements (R)** stage: When capturing assumptions about user behavior, system constraints, or external factors
- Less common in later stages where uncertainties should be resolved before proceeding

### Step 2: Assess the Uncertainty
Clearly articulate:
- What is unknown or uncertain
- Why this uncertainty matters to the project
- What specific decision or outcome depends on resolving this uncertainty
- What information would be needed to resolve it

### Step 3: Determine Criticality
Rate the uncertainty using this scale:
- **High**: Blocks progress, could cause major rework if resolved incorrectly, affects foundational decisions
- **Medium**: Causes delays or extra work if unresolved, affects intermediate decisions
- **Low**: Nice to know but doesn't block progress, affects minor details

### Step 4: Identify Resolution Path
Determine:
- Who is responsible for resolving this (role or specific person)
- What actions are needed to resolve it (research, prototyping, stakeholder meeting, etc.)
- When it should be resolved by (specific phase, milestone, or date)
- What possible solutions or approaches are being considered

### Step 5: Format the GAP Entry
Create a table row using this exact format:

```
| GAP-XXX | [Clear description of uncertainty] | [Criticality] | [Owner/Role] | [Target Resolution] | [Status] | [Related Decisions/Artifacts] |
```

Field explanations:
- **GAP-XXX**: Sequential ID (project can maintain a counter or use descriptive IDs)
- **Description**: Concise but complete statement of what is unknown
- **Criticality**: High/Medium/Low as determined in Step 3
- **Owner/Role**: Person or role responsible for resolution (e.g., "Data Team", "Lead Architect", "Product Owner")
- **Target Resolution**: When it should be resolved (e.g., "Фаза 2", "Before API freeze", "2026-Q3", "After user research")
- **Status**: Open/Closed/Resolved (default to "Open" when creating)
- **Related Decisions/Artifacts**: Links to specs, ADRs, or other documents affected by this uncertainty

### Step 6: Add Human-in-the-Loop Checkpoint
Before finalizing, trigger human review for:
- **Source Contradiction**: Conflicting information from different sources
- **Requirement Ambiguity**: Unclear or conflicting requirements affecting scope/acceptance
- **Architectural Significance**: Decisions with major system implications
- **Terminological Conflict**: Inconsistent use of key terms

### Step 7: Add to GAP Registry
If a GAP registry table already exists in the document:
- Add the new row to the table maintaining sequential ordering
If no GAP registry exists:
- Create a new table with this header:
```
## GAP Registry
| ID | Description | Criticality (High/Med/Low) | Owner | Expected Resolution | Status | Related Decisions |
```
- Add the new row as the first entry

## Quality Checks
Before considering this procedure complete:
- [ ] Description is clear, specific, and actionable
- [ ] Criticality rating is justified
- [ ] Owner is specific enough to know who to follow up with
- [ ] Target resolution is concrete (not vague like "soon" or "eventually")
- [ ] Status is set to "Open" for new entries
- [ ] Related decisions/artifacts are specified when applicable
- [ ] Table formatting is consistent with Markdown standards
- [ ] For Russian docs, field names are translated appropriately
- [ ] SDD stage appropriateness confirmed (Domain/Requirements stages preferred)
- [ ] Human-in-the-loop review triggered for uncertainty assessment

## Example Output
For an open question about microchip uniqueness:

```
| GAP-001 | Should we enforce uniqueness of microchip + species at DB level to prevent duplicate registrations? | High | Data Team | Фаза 2 | Open | ADR-0003 (proposed), animal-domain.md |
```

For an assumption about user behavior:

```
| GAP-007 | Users will understand that matching is a suggestion tool and not a guarantee of fertility or pregnancy | Low | UX Researcher | Фаза 1 (validation) | Open | matching-domain.md, user-flows.md |
```

## Notes
- GAP entries should be reviewed regularly during sprint planning or backlog grooming
- When an uncertainty is resolved, update the Status field and add a brief note in the Description about the resolution
- Consider linking GAP entries to ADRs when they lead to formal architectural decisions
- In Russian documentation, translate field names but keep GAP-ID format consistent
- The GAP registry serves as a backlog for discovery work and should be treated with similar priority as implementation tasks
- This procedure operationalizes SDD principles by making uncertainty explicit and manageable rather than hiding it behind confident-sounding statements
- Human-in-the-loop review is required for uncertainty assessment to ensure expert judgment is applied when determining what constitutes a genuine GAP vs. something that should be resolved