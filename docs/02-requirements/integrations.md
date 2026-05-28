# Integrations: ZooLink

## Purpose
Documents external systems and services that ZooLink integrates with to provide core functionality. This includes both MVP integrations and planned future integrations.

## MVP Integrations
These integrations are required for the MVP to function.

### 1. Authentication Providers
- **Google OAuth 2.0**
  - Purpose: Allow users to register/login with Google account
  - Data exchanged: User ID, email, name, profile picture (optional)
  - Security: Uses OAuth 2.0 flow with state parameter and PKCE
  - Fallback: If Google fails, user can use phone/SMS auth
  - Rate limits: Subject to Google's API quotas (monitored)

- **Apple Sign In**
  - Purpose: Allow users to register/login with Apple ID
  - Data exchanged: User ID, email (if shared), name
  - Security: Uses OAuth 2.0 with JWT
  - Fallback: Alternative auth methods available

- **Telegram Login**
  - Purpose: Allow users to register/login with Telegram account
  - Data exchanged: User ID, username, first name, last name, photo URL
  - Security: Uses Telegram's Login Widget protocol
  - Fallback: Alternative auth methods available

- **VK Login (VKontakte)**
  - Purpose: Allow users to register/login with VK account
  - Data exchanged: User ID, email, name, photo URL
  - Security: Uses VK's OAuth 2.0 implementation
  - Fallback: Alternative auth methods available

### 2. SMS Gateway
- **Provider**: Twilio (or similar with free tier)
- ** Purpose**: Send verification codes for phone number authentication
- ** Data exchanged**: Phone number, verification code
- ** Security**: Uses HTTPS with API keys stored in secret management
- ** Rate limits**: Monitored to stay within free tier; upgrade path available
- ** Fallback**: If SMS fails, user can use OAuth providers

### 3. Geocoding and Mapping
- **Provider**: Yandex.Maps API (free tier)
- ** Purpose**: 
  - Convert city/region names to coordinates for geo-search
  - Calculate distances between users and listings
  - Display map views in listing details
- ** Data exchanged**: 
  - Request: Address components (city, region)
  - Response: Latitude/longitude, formatted address
- ** Security**: API key restricted to specific referrers and IP ranges
- ** Rate limits**: 
  - Free tier: 10,000 requests/day (monitored)
  - Beyond free tier: paid tier or switch to OSM/PostGIS
- ** Fallback**: 
  - For MVP: Use simplified city-to-city distance (straight-line) if API fails
  - Future: Switch to self-hosted OSM with PostGIS for unlimited use

### 4. Email Service
- **Provider**: SendGrid (or similar)
- ** Purpose**: Send transactional emails only
  - Email verification (optional)
  - Moderation results (approve/reject)
  - Password reset (if implemented)
  - System notifications
- ** Data exchanged**: Recipient email, subject, body (HTML/text)
- ** Security**: API key with limited permissions (send only)
- ** Rate limits**: Monitored to stay within free tier
- ** Fallback**: 
  - For non-critical emails: in-app notifications only
  - Critical: SMS fallback for verification codes

### 5. Object Storage (for Photos)
- **Provider**: S3-compatible service (MinIO for dev, AWS S3 or similar for prod)
- ** Purpose**: Store and serve listing photos and user avatars
- ** Data exchanged**: 
  - Upload: Pre-signed PUT URL, photo file
  - Retrieval: Direct GET to object URL (via CDN or direct)
- ** Security**: 
  - Bucket policies: Private bucket, access via pre-signed URLs only
  - Encryption: Server-side encryption (SSE-S3) enabled
  - Access controls: CORS restricted to ZooLink domains
- ** Rate limits**: 
  - Requests: Monitored for abuse
  - Storage: Monitored for cost
- ** Fallback**: 
  - If primary storage fails: secondary bucket in different region
  - For development: local file storage (not for prod)

## Future Integrations (Facза 2+)
These integrations are planned for later phases.

### 6. Payment Gateway
- **Purpose**: Process payments for monetization features (Boost, premium profiles, escrow)
- **Providers Considered**: Stripe, PayPal, Yandex.Kassa
- **Data exchanged**: Payment details, transaction metadata
- **Security**: PCI DSS compliance via certified gateway (we don't handle raw card data)
- **Integration**: API-based, webhooks for payment status

### 7. Advanced Mapping/Geo Services
- **Purpose**: Enhanced geo-search, routing, and location-based features
- **Providers Considered**: 
  - Google Maps Platform (Directions, Distance Matrix, Places)
  - Mapbox
  - Open-source: OSRM, GraphHopper (self-hosted)
- **Data exchanged**: Origins, destinations, travel mode
- **Use Cases**:
  - Calculate driving distance/time for meetup arrangements
  - Show route on map
  - Find listings along a route
  - Service area searches (for vets, transporters)

### 8. Veterinary and Health Services
- **Purpose**: Integrate with vet clinics for health record verification and appointment booking
- **Providers Considered**: 
  - Practice management software (e.g., IDEXX, AVImark)
  - Telemedicine platforms
  - Lab result portals
- **Data exchanged**: Vaccination records, test results, appointment scheduling
- **Use Cases**:
  - Verify vaccination claims in listings
  - Allow users to book vet visits through platform
  - Display upcoming health appointments in animal profile

### 9. Logistics and Transport Services
- **Purpose**: Facilitate animal transport arrangements (especially for livestock)
- **Providers Considered**: 
  - Livestock transport companies
  - General freight APIs (e.g., Uber Freight, Convoy)
  - Specialized animal transport platforms
- **Data exchanged**: Pickup/delivery details, animal specs, regulatory docs
- **Use Cases**:
  - Provide transport quotes
  - Generate health certificates for interstate movement
  - Track shipments in real-time

### 10. Genetic Testing Services
- **Purpose**: Allow users to order and view genetic test results directly
- **Providers Considered**: 
  - Commercial genetic testing labs (e.g., Zoetis, Neogen, Embark)
  - University extension services
- **Data exchanged**: Test orders, results (raw data and interpretations)
- **Use Cases**:
  - Display genetic health panels in animal profiles
  - Suggest complementary mates based on genetic compatibility
  - Alert users to potential genetic disorders

### 11. Regulatory Systems (Меркурий/ВетИС)
- **Purpose**: Comply with livestock movement reporting requirements (Facза 3 for livestock)
- **Provider**: Russian Federal State Information System "Меркурий" (VetIS)
- **Data exchanged**: 
  - Outgoing: Livestock movement requests (permit applications)
  - Incoming: Movement confirmations, disease outbreak alerts
- **Use Cases**:
  - Automate permit creation for listed livestock sales
  - Validate that buyers have proper reception facilities
  - Receive alerts about regional disease outbreaks
  - Maintain audit trail for compliance audits

### 12. Social Media Platforms
- **Purpose**: Enhance user profiles and enable sharing
- **Providers Considered**: 
  - Facebook, Instagram, Twitter/X
  - TikTok, YouTube
- **Data exchanged**: 
  - Outgoing: Share listings, achievements, articles
  - Incoming: Profile pictures, basic info (via login)
- **Use Cases**:
  - Allow users to share their listings on social media
  - Import profile pictures from social accounts
  - Enable social login (already covered in MVP integrations)
  - Fetch breed-related content for encyclopedia

### 13. Content and Media Services
- **Purpose**: Enhance content delivery and user experience
- **Providers Considered**: 
  - Video streaming (Vimeo, YouTube API for embedded content)
  - Image processing (Cloudinary, Imgix for on-the-fly transformations)
  - Document generation (Docraft, PDFLib for contracts/certificates)
  - News APIs (for agriculture/pet news section)
- **Use Cases**:
  - Optimize image delivery (resize, format, compress)
  - Generate sale contracts and health certificates
  - Embed educational videos in articles
  - Display relevant news in user feed

### 14. Analytics and Monitoring
- **Purpose**: Improve observability and business intelligence
- **Providers Considered**: 
  - Application Performance Monitoring: Datadog, New Relic
  - Log Aggregation: ELK Stack, Splunk
  - Error Tracking: Sentry, Rollbar
  - Business Intelligence: Tableau, Power BI, or open-source (Metabase, Superset)
- **Data exchanged**: 
  - Outgoing: Metrics, logs, traces, events
  - Incoming: Dashboards, alerts, reports
- **Use Cases**:
  - Monitor system health and performance
  - Track user behavior and conversion funnels
  - Debug issues in production
  - Generate reports for stakeholders

## Integration Principles
1. **Loose Coupling**: 
   - Integrations are behind adapters or services
   - Allows swapping providers without changing core logic
2. **Security First**: 
   - API keys stored in secret management (never in code)
   - Principle of least privilege for API keys
   - Regular rotation of credentials
3. **Error Handling and Resilience**:
   - Circuit breaker pattern for external calls
   - Fallback mechanisms where possible
   - Graceful degradation (e.g., if maps fail, use simpler distance)
4. **Rate Limiting and Quotas**:
   - Monitor usage against provider limits
   - Implement client-side throttling
   - Alert on approaching limits
5. **Data Privacy**:
   - Only share necessary data with third parties
   - Respect user consent for data sharing
   - Anonymize/pseudonymize data where possible
6. **Observability**:
   - Log integration calls (success/failure, latency)
   - Track external service health
   - Alert on integration failures

## Integration Documentation
Each integration should have:
- **API Contract**: OpenAPI/Swagger or equivalent
- **Authentication Method**: OAuth, API key, etc.
- **Data Mapping**: How our internal models map to external fields
- **Error Handling**: Specific error codes and fallback behavior
- **Security Considerations**: Encryption, token storage, etc.
- **Testing Plan**: How to test the integration (mock service, sandbox)
- **Deployment Considerations**: Environment variables, secrets required

## Open Questions & Assumptions
- **Assumption**: Third-party providers will maintain backward compatibility for their APIs during MVP period.
- **Assumption**: Free tiers of SMS, mapping, and email services are sufficient for MVP validation.
- **Open Question**: Should we abstract the geocoding service to allow switching between providers without code changes? (Decided: Yes, via adapter pattern.)
- **Assumption**: Users consent to sharing necessary data for integrations (e.g., phone number for SMS, basic profile for OAuth).
- **Assumption**: Payment gateway integration will be added in Facза 2 and will use a PCI-compliant provider to avoid handling card data directly.
- **Assumption**: Regulatory integration (Меркурий) will require separate legal review and possibly a data sharing agreement.