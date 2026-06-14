# Species-Specific Validation Rules - Decision Table

## Overview
This decision table defines validation rules for animal listings based on species/breed combinations. Each rule specifies required fields, constraints, and validation logic.

## Decision Table Structure
Conditions (C1-CN) represent species/breed attributes.
Actions (A1-AN) represent validation requirements.
R (Rule) columns represent specific combinations.

| Conditions | C1: Species | C2: Breed Category | C3: Age Unit | C4: Jurisdiction | Actions | A1: Required ID Type | A2: Min Age (months) | A3: Required Documents | A4: Special Constraints |
|------|-------------|-------------------|--------------|------------------|--------------------|--------------------|--------------------|--------------------|--------------------|
| R1   | Cattle      | Dairy/Beef        | Months       | RF               | Ear Tag            | 0                  | Veterinary Passport| Must have valid ear tag format (XXX-XXX-XXX) |
| R2   | Cattle      | Dairy/Beef        | Months       | EU               | Ear Tag/Passport   | 0                  | Animal Passport    | Must comply with EU livestock tracing |
| R3   | Cattle      | Dairy/Beef        | Months       | US               | Brand/Tag          | 0                  | Health Certificate | Must have USDA-approved identification |
| R4   | Horses      | All               | Years        | RF               | Passport/Microchip | 12                 | Veterinary Passport| Must have valid passport with vaccination records |
| R5   | Horses      | All               | Years        | EU               | Passport/Microchip | 12                 | Animal Passport    | Must comply with EU equine regulations |
| R6   | Horses      | All               | Years        | US               | Microchip/Brand    | 12                 | Coggins Test       | Require negative EIA test within 12 months |
| R7   | Sheep/Goats | All               | Months       | RF               | Ear Tag/Tattoo     | 2                  | Veterinary Cert    | Must have flock/herd identification |
| R8   | Sheep/Goats | All               | Months       | EU               | Ear Tag/Tattoo     | 2                  | Animal Health Cert | Must comply with EU sheep/goat regulations |
| R9   | Sheep/Goats | All               | Months       | US               | Ear Tag/Tattoo     | 2                  | Scrapies Cert      | Require scrapies compliance documentation |
| R10  | Pigs        | All               | Months       | RF               | Ear Tag/Tattoo     | 1                  | Veterinary Cert    | Must have farm identification |
| R11  | Pigs        | All               | Months       | EU               | Ear Tag/Tattoo     | 1                  | Animal Health Cert | Must comply with EU swine regulations |
| R12  | Pigs        | All               | Months       | US               | Ear Tag/Tattoo     | 1                  | Health Certificate | Require PRRS/PEDV negative status if applicable |
| R13  | Dogs        | All               | Months       | ANY              | Microchip/Tattoo   | 8                  | Vaccination Record | Must have valid rabies vaccination |
| R14  | Dogs        | Dangerous Breeds* | Months       | RF/EU/US         | Microchip          | 8                  | Vaccination + License| Additional liability insurance required |
| R15  | Cats        | All               | Months       | ANY              | Microchip/Tattoo   | 8                  | Vaccination Record | Must have valid rabies vaccination |
| R16  | Exotic      | CITES Appendix I  | Months       | ANY              | Microchip + Docs   | 12                 | CITES Permit       | International trade permit required |
| R17  | Exotic      | CITES Appendix II | Months       | ANY              | Microchip + Docs   | 6                  | CITES Permit       | Export/import permit required |
| R18  | Birds       | Poultry           | Weeks        | RF/EU/US         | Leg Band/Microchip | 6                  | Poultry Health Cert| Must comply with avian influenza regulations |
| R19  | Birds       | Companion/Pet     | Months       | ANY              | Microchip/Leg Band | 4                  | Vaccination Record | Psittacosis test may be required |
| R20  | Reptiles    | All               | Months       | ANY              | Microchip/PIT Tag  | 3                  | Health Certificate | Species-specific habitat requirements apply |
| R21  | Other Livestock | All          | Months       | RF               | Ear Tag/Brand      | 0                  | Veterinary Cert    | Standard livestock identification applies |
| R22  | Other Livestock | All          | Months       | EU               | Ear Tag/Brand      | 0                  | Animal Health Cert | EU livestock tracing compliance |
| R23  | Other Livestock | All          | Months       | US               | Ear Tag/Brand      | 0                  | Health Certificate | State-specific requirements may apply |
| R24  | Other Pets  | All               | Months       | ANY              | Microchip/Tattoo   | 2                  | Vaccination Record | Basic vaccination and health check required |

## Legend
* **Dangerous Breeds** (for dogs): Pit Bull, Staffordshire Terrier, Rottweiler, Doberman, etc. as defined by local legislation
* **Jurisdiction**: RF = Russian Federation, EU = European Union, US = United States, ANY = applies to all jurisdictions
* **Age Unit**: Specifies whether age is measured in months, years, or weeks
* **Required Documents**: Documents that must be provided/uploaded with the listing
* **Special Constraints**: Additional validation rules beyond standard documentation

## Default Rules (when no specific match)
- **Species not listed**: Require microchip or tattoo + basic health certificate
* **Age below minimum**: Listing rejected with error "Animal too young for transfer/sale"
* **Missing required documents**: Listing blocked until documents provided
* **Invalid ID format**: Specific error message based on ID type (e.g., "Invalid ear tag format")

## Implementation Notes
1. This decision table should be implemented as a rule engine that evaluates conditions in order
2. First matching rule (top-to-bottom) determines validation requirements
3. All validations must pass before listing can transition from DRAFT to PENDING_MODERATION
4. Validation errors should be returned as field-specific errors with clear user guidance
5. Jurisdiction should be determined from listing location (country/region)
6. Breed category determination may require external breed database lookup for complex cases