# ZooLink SDD Skills

This directory contains standardized procedures (skills) for AI agents working with the ZooLink project documentation following Spec-Driven Documentation (SDD) principles.

## Available Skills

### 1. nfr-traceability-generator.md
**Purpose**: Create standardized Non-Functional Requirements (NFR) traceability sections for specification documents.

**Usage**: When creating or updating any specification document to ensure consistent NFR traceability to performance.md, security.md, and accessibility.md.

### 2. gap-registry-generator.md
**Purpose**: Create standardized GAP (uncertainty) registry entries for tracking assumptions, open questions, and unknowns.

**Usage**: When documenting assumptions, open questions, or uncertainties that need to be tracked and resolved during the project lifecycle.

### 3. dod-generator.md
**Purpose**: Create standardized Definition of Done (DoD) sections for specification documents.

**Usage**: When defining clear completion criteria for artifacts to ensure they are ready to serve as foundations for subsequent work.

## How to Use These Skills

AI agents should follow these procedures exactly as documented to ensure:
- Consistent documentation quality
- Proper traceability between artifacts
- Explicit management of uncertainty
- Clear completion criteria
- Reduced variance in AI-generated outputs

These skills operationalize the SDD principles described in the project documentation and help maintain the documentation as a reliable, engineering-grade artifact.

## Adding New Skills

To add new skills:
1. Create a new markdown file in this directory
2. Follow the same format: Purpose, When to Use, Inputs, Outputs, Procedure Steps, Quality Checks, Example Output, Notes
3. Focus on repetitive, procedural tasks that benefit from standardization
4. Update this README to document the new skill