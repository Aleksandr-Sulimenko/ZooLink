# Target Audience: ZooLink

## Purpose
Defines the primary user segments for ZooLink, their characteristics, goals, and pain points. This document helps prioritize features and design decisions.

## Primary Segments

### 1. Companion Animal Owners (Pet Segment)
#### Sub-segments:
- **Casual Owners**: Individuals who own pets (cats, dogs, birds, small mammals) for companionship.
- **Hobby Breeders**: Individuals who breed pets selectively, often for specific traits or shows.
- **Rescue/Shelter Workers**: Individuals or organizations involved in rehoming animals.

#### Characteristics:
- Typically urban/suburban residents
- Moderate to high disposable income for pet care
- Active on social media and online communities
- Value convenience, trust, and safety in transactions
- Often first-time buyers/sellers may be nervous about scams

#### Goals:
- Find suitable mates for their pets (for breeding)
- Sell offspring or rehome pets safely and quickly
- Buy pets with verified health and background
- Connect with local community of pet owners
- Access resources (tips, vet recommendations)

#### Pain Points:
- Difficulty verifying health claims and lineage of pets sold online
- Risk of scams (non-payment, misrepresentation) on general classifieds
- Time-consuming search across multiple platforms and groups
- Lack of reputation system for buyers/sellers
- Stress of arranging meetups and verifying identities

#### How ZooLink Helps:
- Verified profiles and moderated listings reduce scam risk
- Geographic search connects users locally
- Standardized profiles include health, temperament, and basic lineage
- Contact reveal after moderation ensures initial safety
- Community features (planned) build trust over time

### 2. Livestock Owners and Farmers (Livestock Segment)
#### Sub-segments:
- **Small Farm Owners**: Owners of small herds/flocks for personal use or local sale.
- **Commercial Breeders**: Focused on breeding stock for sale to other farmers.
- **Feedlot/Slaughter Producers**: Owners raising animals for meat production.
- **Dairy Farmers**: Focused on milk production and herd replacement.
- **Horse Breeders/Trainers**: Focused on breeding, training, or selling horses for specific disciplines.

#### Characteristics:
- Often rural residents
- Income closely tied to livestock productivity and market prices
- Value efficiency, productivity metrics, and genetic quality
- Experienced in animal husbandry but may lack digital savvy
- Transactions often involve higher values and longer negotiation cycles

#### Goals:
- Sell breeding stock with verified production and genetic records
- Find mates or stud services to improve herd genetics
- Buy productive animals (dairy cows, feeder animals, etc.)
- Lease animals (e.g., bull lease, dairy cow lease)
- Connect with veterinarians, transport services, and advisors
- Access market information and trends

#### Pain Points:
- Difficulty finding qualified buyers for breeding stock
- Risk of misrepresented production data or health status
- Time spent negotiating and verifying documents (health tests, pedigree)
- Lack of centralized platform for livestock-specific traits (conformation, production)
- Geographic limitations: need to transport animals or semen/embryos
- Complexity of regulatory compliance for movement (укратко: Меркурий)

#### How ZooLink Helps:
- Structured listings emphasize productivity, health certifications, and genetics
- Moderation ensures basic authenticity (photos match animal, no spam)
- Geographic search enables local or regional transactions
- Standardized fields for production records (milk yield, weight gain) and health tests
- Contact reveal after moderation for initial trust
- Future features: reproductive calendar, genetics portal, regulatory integration

### 3. Moderators and Advisors (Platform Roles)
#### Sub-segments:
- **Community Moderators**: Trusted users who review listings for quality and compliance.
- **Veterinarians and Advisors**: Professionals who may use the platform to connect with clients or share expertise.
- **Breed Association Representatives**: Officials from clubs or associations who may monitor listings.

#### Characteristics:
- Often experienced animal owners or professionals
- Motivated by community contribution, reputation, or professional networking
- May have limited time but want to contribute to a trusted platform
- Value clear guidelines and tools to perform their role effectively

#### Goals:
- Maintain a high-quality, trustworthy marketplace
- Help users avoid scams and misinformation
- Build reputation as knowledgeable community members
- Access to a network of serious buyers/breeders
- (For professionals) Generate leads for services

#### Pain Points:
- Lack of clear guidelines or tools for moderation
- Frustration with low-quality or spammy listings
- Difficulty contacting users to request clarifications
- No recognition or incentives for contribution
- Inefficient processes (e.g., switching between platforms)

#### ZooLink Provides:
- Dedicated moderation queue with clear approval/reject workflow
- Standardized rejection reasons and feedback to users
- Tools to manage reference data (breeds, species)
- Analytics on moderation activity
- Planned reputation system for contributors

## Secondary Audiences
These users are not the primary focus but may benefit or interact with the platform.

### 1. Service Providers
- Veterinarians, farriers, trainers, transport companies
- May use the platform to advertise services or connect with clients
- Planned lead generation features (Facза 2)

### 2. Researchers and Analysts
- Academics, industry analysts interested in market trends
- Planned anonymized data exports for market intelligence (Facза 2+)

### 3. Regulatory Authorities
- Veterinary services, agricultural departments
- Not direct users on MVP, but platform aims to facilitate future compliance (Меркурий)

## Anti-Personas (Who We Are Not Targeting Initially)
- **Large Industrial Integrators**: Multi-national corporations with proprietary systems (may be future B2B clients)
- **Users Seeking Illegal Activities**: Platform moderation and policies prohibit illegal animal trade
- **Users Unwilling to Verify Identity**: Phone/OAuth auth required; no anonymous browsing
- **Users Seeking Instant Gratification**: Platform requires moderation; not a instant classifieds

## User Journey Maps (High-Level)
See `05-ui-ux/user-flows.md` for detailed journeys.

## Assumptions About the Audience
- Users are willing to verify identity via phone or OAuth for access to a trusted marketplace.
- Users value safety and trust over absolute anonymity in transactions.
- Users have basic smartphone/computer literacy to use a web application.
- Users are motivated to participate in a community that reduces transaction risks.
- Geographic proximity is important for pet transactions; less so for high-value livestock (where transport is common).

---
*This document complements the stakeholder analysis in `problem-statement.md` and feeds into feature prioritization and UI/UX design.*