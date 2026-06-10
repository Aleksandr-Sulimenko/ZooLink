# Procedure: Format API Contract References

## Purpose
Create a standardized API Contract References section for specification documents that consistently references related API contracts, following Spec-Driven Documentation (SDD) principles.

## When to Use
This procedure should be used when creating or updating specification documents that need to reference API contracts, particularly during the Requirements (R) and Architecture (A) stages of the SDD lifecycle.

## Inputs
- Specification document being worked on
- List of related API contracts (YAML files in api-contracts/)
- Understanding of which endpoints are relevant to the specification
- Current SDD stage confirmation (helps determine appropriateness)

## Outputs
- API Contract References section ready for inclusion in specification documents
- Consistent, formatted references to API contracts
- Documentation of API contract traceability for human-in-the-loop review

## Procedure Steps

### Step 1: Confirm SDD Stage Appropriateness
API contract references are appropriate during:
- **Requirements (R)** stage: When specifying what the system should do, referencing how it will be implemented via APIs
- **Architecture (A)** stage: When defining component interactions and interfaces
- Less common in Domain (D) stage unless specifying data models that map to API schemas
- Common in Verification (T) stage when defining test activities

### Step 2: Identify Related API Contracts
Determine which API contracts are relevant to the specification:
- Review the `docs/03-architecture/api-contracts/` directory
- Identify YAML files that implement functionality described in the specification
- Note which specific endpoints, paths, or operations are relevant
- Consider both direct implementations and related/supporting APIs

### Step 3: Determine Reference Details
For each relevant API contract:
- Note the file path relative to the project root
- Identify specific endpoints/paths that implement specification requirements
- Determine HTTP methods and status codes that are relevant
- Note any specific request/response schema elements that are important
- Consider security schemes, examples, or other relevant details

### Step 4: Generate API Contract References Section
Create the section using this format:

```
## API Contract References (see [path/to/api-contract.yaml])
- [EndPoint/Operation]: [Brief description of what it does and how it relates to specification]
  - Path: [API path]
  - Method: [HTTP method(s)]
  - Status Codes: [Relevant status codes]
  - Request/Response: [Key schema elements if relevant]
  - Security: [Authentication/authorization requirements if relevant]
```

For multiple references to the same file:
```
## API Contract References
- See [path/to/api-contract.yaml] for:
  - [EndPoint/Operation]: [Description]
  - [EndPoint/Operation]: [Description]
```

### Step 5: Add Human-in-the-Loop Checkpoint
Before finalizing, trigger human review for:
- **Source Contradiction**: Conflicting information from different sources about API implementation
- **Requirement Ambiguity**: Unclear or conflicting requirements affecting API interpretation
- **Architectural Significance**: API references with major system implications
- **Traceability Completeness**: Ensuring all specification requirements have API counterparts

### Step 6: Add Verification Criteria Items
Add these items to the Verification Criteria section of the specification:
```
- [ ] API Contract References: All relevant API contracts are properly referenced
- [ ] API Contract References: References are accurate and point to correct endpoints
- [ ] API Contract References: Traceability between specification and API contracts is clear
```

## Quality Checks
Before considering this procedure complete:
- [ ] All relevant API contracts are identified and referenced
- [ ] References point to correct file paths and endpoints
- [ ] Reference format is consistent and follows the specified structure
- [ ] Human-in-the-loop review triggered for API reference questions
- [ ] SDD stage appropriateness confirmed (Requirements/Architecture stages preferred)
- [ ] References are written in clear, implementation-guiding language
- [ ] For Russian docs, procedure terminology translated appropriately

## Example Output
For a pet marketplace domain specification:

```
## API Contract References (see 03-architecture/api-contracts/listings-api.yaml)
- `GET /listings`: Search listings with filters
  - Path: /listings
  - Method: GET
  - Status Codes: 200 (success), 400 (bad request), 500 (server error)
  - Request/Response: Query parameters for species, breed, price range, etc.; Response array of listing objects
  - Security: Requires authentication for private listings
- `POST /listings`: Create new listing
  - Path: /listings
  - Method: POST
  - Status Codes: 201 (created), 400 (validation error), 401 (unauthorized)
  - Request/Response: Listing creation schema; Response includes created listing ID
  - Security: Requires authentication
- `GET /listings/{id}`: Get listing by ID
  - Path: /listings/{id}
  - Method: GET
  - Status Codes: 200 (success), 404 (not found), 403 (forbidden)
  - Request/Response: Path parameter for ID; Response includes full listing details
  - Security: Authentication required; authorization based on ownership/listing status
```

## Notes
- API contract references should guide implementation by clearly linking specification requirements to API implementations
- Always verify that the referenced API contract files exist and contain the referenced endpoints
- Consider using relative paths from the specification document location for clarity
- This procedure operationalizes SDD principles by ensuring traceability between requirements and API contracts
- Human-in-the-loop review is required for API reference determination to ensure expert judgment is applied when deciding what constitutes a proper reference