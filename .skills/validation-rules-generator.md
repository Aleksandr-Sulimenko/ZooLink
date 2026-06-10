# Procedure: Generate Validation Rules Section

## Purpose
Create a standardized Validation Rules section for specification documents that defines clear, testable validation rules for data attributes, following Spec-Driven Documentation (SDD) principles.

## When to Use
This procedure should be used when creating or updating specification documents that define data models or attributes requiring validation, particularly during the Models/Data (M) stage of the SDD lifecycle.

## Inputs
- Data model or attribute list being specified
- Understanding of validation requirements for each attribute
- Any domain-specific validation rules
- Current SDD stage confirmation (should be Models/Data/M stage)

## Outputs
- Validation Rules section ready for inclusion in specification documents
- Clear, testable validation rules for each attribute
- Documentation of validation rules for human-in-the-loop review

## Procedure Steps

### Step 1: Confirm SDD Stage
Verify that you are working on a Models/Data (M) specification:
- This procedure is specifically for Models/Data stage work
- If working on other stages, adapt accordingly (e.g., Requirements may reference validation needs)
- Validation rules are most relevant to Models/Data stage but may be mentioned in Requirements

### Step 2: List Attributes and Requirements
For each attribute in the data model:
- List the attribute name, type, and requirement status (required/optional)
- Note any specific validation requirements (format, range, uniqueness, etc.)
- Identify cross-attribute validations (e.g., date ranges, conditional requirements)

### Step 3: Determine Validation Approach
For each attribute, determine:
- **Format Validation**: Pattern, length, allowed characters (e.g., email, UUID, phone)
- **Range Validation**: Numerical ranges, date boundaries, enumerated values
- **Consistency Validation**: Cross-field validation, logical constraints
- **Uniqueness Validation**: Database-level uniqueness where applicable
- **Referential Integrity**: Foreign key constraints where applicable

### Step 4: Generate Validation Rules Section
Create the section using this format:

```
## Validation Rules
- [Attribute Name]: [Validation description]
  - Required: [Yes/No]
  - Type: [Data type]
  - Format: [Pattern/constraint] (if applicable)
  - Range: [Minimum/maximum or enumerated values] (if applicable)
  - Uniqueness: [Database level/application level] (if applicable)
  - References: [Foreign key reference] (if applicable)
  - Validation: [Application-level validation notes] (if applicable)
```

For complex validations or cross-attribute rules, use:
```
## Validation Rules
- [Attribute Name]: As defined above
- [Cross-Attribute Rule]: [Description of validation involving multiple attributes]
```

### Step 5: Add Human-in-the-Loop Checkpoint
Before finalizing, trigger human review for:
- **Requirement Ambiguity**: Unclear or conflicting validation requirements
- **Source Contradiction**: Conflicting information from different sources about validation needs
- **Architectural Significance**: Validation rules with major system implications (security, compliance)

### Step 6: Add Verification Criteria Items
Add these items to the Verification Criteria section of the specification:
```
- [ ] Validation Rules: All attributes have clear, testable validation rules
- [ ] Validation Rules: Rules are implementable and can be automated where appropriate
- [ ] Validation Rules: Cross-attribute validations are clearly defined and testable
```

## Quality Checks
Before considering this procedure complete:
- [ ] All attributes have validation rules documented
- [ ] Validation rules are specific, measurable, and actionable
- [ ] Validation rules cover format, range, consistency, uniqueness, and referential integrity where applicable
- [ ] Human-in-the-loop review triggered for validation requirement questions
- [ ] SDD stage confirmation completed (Models/Data/M stage)
- [ ] Validation rules are written in implementation-guiding language
- [ ] For Russian docs, procedure terminology translated appropriately

## Example Output
For an animal domain specification:

```
## Validation Rules
- `species_id`: Reference to species directory
  - Required: Yes
  - Type: Integer (FK to species.id)
  - Validation: Must exist in species directory (application-level validation)
- `breed_id`: Reference to breed directory or custom text
  - Required: No (nullable if breed_text provided)
  - Type: Integer (FK to breed.id) or String
  - Validation: Either breed_id or breed_text must be provided (application-level validation)
- `breed_text`: Custom breed text for moderator review
  - Required: No
  - Type: String (max 100 characters)
  - Validation: Required when breed_id is null; flagged for moderator review
- `date_of_birth`: Date of birth
  - Required: Yes
  - Type: Date
  - Range: Must be in the past and not more than 30 years ago (configurable per species)
  - Validation: Date must be valid and within acceptable range
- `microchip_id`: Microchip identifier
  - Required: No
  - Type: String (max 50 characters)
  - Format: At least 8 characters if provided
  - Validation: Format validation; uniqueness warning (not enforced globally)
- `owned_since`: Date of ownership acquisition
  - Required: No
  - Type: Date
  - Range: Must be in the past and not after date_of_birth + current age
  - Validation: Date must be valid and pass sanity check
- `health_records`: JSONB array of health events
  - Required: No
  - Type: JSONB
  - Validation: Must conform to schema [ {type: string, detail: string, date: date, provider: string} ]
- `reproductive_data`: JSONB array of reproductive events
  - Required: No
  - Type: JSONB
  - Validation: For females only; events must have valid types and dates
```

## Notes
- Validation rules should be written in a way that guides implementation (e.g., "application-level validation" specifies where to implement)
- Always consider both application-level and database-level validation where appropriate
- For JSONB fields, specify the expected schema structure
- This procedure operationalizes SDD principles by ensuring data models have clear, testable validation rules
- Human-in-the-loop review is required for validation requirement determination to ensure expert judgment is applied when defining what constitutes valid data