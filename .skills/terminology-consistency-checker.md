# Procedure: Check Terminology Consistency

## Purpose
Create a standardized Terminology Consistency check for specification documents that ensures consistent use of terms across the ZooLink project documentation, following Spec-Driven Documentation (SDD) principles.

## When to Use
This procedure should be used when creating or updating any specification document in the ZooLink project to ensure consistent terminology usage, particularly important during all stages of the SDD lifecycle but especially critical during Domain (D) and Requirements (R) stages.

## Inputs
- Specification document being worked on
- Access to project glossary (glossary.md)
- Access to other related specification documents for cross-checking
- Current SDD stage confirmation (helps determine focus areas)

## Outputs
- Terminology consistency verification
- List of any inconsistencies found
- Documentation of terminology check for human-in-the-loop review
- Updated terminology entries if new terms are defined (in appropriate documents)

## Procedure Steps

### Step 1: Confirm SDD Stage Focus Areas
Different SDD stages have different terminology focus areas:
- **Domain (D)** stage: Primary focus on defining and establishing core terminology (glossary work)
- **Requirements (R)** stage: Focus on using established terminology consistently in requirements
- **Scenarios (S)** stage: Focus on ensuring scenario terminology aligns with requirements and domain
- **Models/Data (M)** stage: Focus on consistent use of data attribute names and types
- **Architecture (A)** stage: Focus on consistent use of architectural terms and component names
- **Verification (T)** stage: Focus on ensuring test terminology aligns with specification terms

### Step 2: Identify Key Terms in Document
Extract key terms from the specification document:
- Domain-specific terms (species, breeds, listing types, etc.)
- Technical terms (API, UUID, JSONB, REST, etc.)
- Process terms (validation, moderation, approval, etc.)
- Acronyms and abbreviations (MVP, NFR, GAP, DoD, etc.)
- Action verbs (create, update, delete, approve, reject, etc.)

### Step 3: Check Against Project Glossary
Verify terminology consistency:
- Check glossary.md for definitions of key terms
- Ensure terms are used consistently with their definitions
- Flag terms not found in glossary for potential addition
- Note any variations in spelling, capitalization, or formatting

### Step 4: Cross-Check Related Documents
Verify consistency with related specifications:
- Check domain specifications for consistent use of domain terms
- Check business requirements for consistent terminology
- Check API contracts for consistent parameter and field names
- Check NFR documents for consistent requirement language

### Step 5: Generate Terminology Consistency Report
Create a report using this format:

```
## Terminology Consistency Check
- [ ] All domain-specific terms checked against project glossary
- [ ] Technical terms used consistently with established meanings
- [ ] Acronyms and abbreviations used consistently (first definition followed by acronym)
- [ ] Action verbs used consistently (e.g., "create" vs "add", "update" vs "modify")
- [ ] Inconsistencies found: [List any inconsistencies or "None found"]
- [ ] New terms identified for glossary addition: [List or "None"]
```

### Step 6: Add Human-in-the-Loop Checkpoint
Before finalizing, trigger human review for:
- **Source Contradiction**: Conflicting terminology usage between different sources
- **Requirement Ambiguity**: Terminology ambiguity affecting requirement interpretation
- **Architectural Significance**: Terminology choices with major system implications
- **GAP Identification**: Terminology uncertainties that should be captured as GAP entries

### Step 7: Add Verification Criteria Items
Add these items to the Verification Criteria section of the specification:
```
- [ ] Terminology Consistency: All terms used are consistent with project glossary and other specifications
- [ ] Terminology Consistency: Key terms have been verified for consistent usage
- [ ] Terminology Consistency: Any inconsistencies have been documented and resolved
```

## Quality Checks
Before considering this procedure complete:
- [ ] Key terms have been extracted and checked against project glossary
- [ ] Cross-check performed with related specification documents
- [ ] Terminology consistency report generated with clear findings
- [ ] Human-in-the-loop review triggered for terminology questions
- [ ] SDD stage focus areas considered in the check
- [ ] For Russian docs, procedure terminology translated appropriately
- [ ] Report format follows the specified structure
- [ ] All inconsistencies either resolved or documented as GAP entries if requiring research

## Example Output
For an animal domain specification:

```
## Terminology Consistency Check
- [x] All domain-specific terms checked against project glossary
- [x] Technical terms used consistently with established meanings
- [x] Acronyms and abbreviations used consistently (first definition followed by acronym)
- [x] Action verbs used consistently (e.g., "create" vs "add", "update" vs "modify")
- [ ] Inconsistencies found: "microchip ID" sometimes written as "microchip_id" in text
- [ ] New terms identified for glossary addition: "owned_since" (date of ownership acquisition)
```

## Notes
- Terminology checking is an ongoing process throughout the SDD lifecycle
- When inconsistencies are found, they should either be resolved immediately or documented as GAP entries if they require research or decision-making
- New terms identified during Domain work should be added to the project glossary with appropriate definitions
- This procedure operationalizes SDD principles by ensuring a single source of truth for terminology through the project glossary
- Human-in-the-loop review is required for terminology consistency to ensure expert judgment is applied when deciding whether variations are acceptable inconsistencies or require standardization