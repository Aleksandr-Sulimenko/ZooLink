# Component Diagram: ZooLink Platform

## Purpose
Shows the high-level components and their interfaces within the ZooLink platform.

## Diagram Description
```mermaid
graph TD
    %% Core Components
    subgraph Core_Components
        direction TB
        Auth_Service[Authentication Service<br/>(JWT, OAuth, SMS)]
        User_Profile[User Profile Service<br/>(CRUD, preferences)]
        Animal_Service[Animal Service<br/>(Lifecycle, ownership)]
        Listing_Service[Listing Service<br/>(CRUD, search, moderation)]
        Moderation_Service[Moderation Service<br/>(Queue, decisions)]
        Matching_Service[Matching Service<br/>(Compatibility, suggestions)]
        Notification_Service[Notification Service<br/>(Email, SMS, push)]
        Geo_Service[Geo Service<br/>(Spatial search, distance)]
        Admin_Service[Admin Service<br/>(Config, reference data)]
        Payment_Service[Payment Service<br/>(Future: transactions)]
    end

    %% Supporting Services
    subgraph Supporting_Services
        direction TB
        APIGateway[API Gateway<br/>(Routing, auth, rate limit)]
        Web_Gateway[Web Gateway<br/>(SSR, asset serving)]
        File_Storage[File Storage Service<br/>(S3, CDN)]
        Search_Engine[Search Engine<br/>(Elasticsearch)]
        Cache_Layer[Cache Layer<br/>(Redis)]
        Event_Bus[Event Bus<br/>(Pub/Sub, messaging)]
        Monitoring[Monitoring & Observability<br/>(Metrics, logs, traces)]
    end

    %% Data Layer
    subgraph Data_Layer
        direction TB
        Primary_DB[(PostgreSQL<br/>Primary)]
        Replica_DB[(PostgreSQL<br/>Replicas)]
        Archive_DB[(Object Storage<br/>Backups)]
    end

    %% External Systems
    subgraph External_Systems
        direction TB
        SMS_Gateway[SMS Provider<br/>(Twilio)]
        Email_Service[Email Provider<br/>(SendGrid)]
        Maps_Service[Maps Provider<br/>(Yandex.Maps)]
        OAuth_Providers[OAuth Providers<br/>(Google, Apple, etc.)]
        Payment_Gateways[Payment Gateways<br/>(Stripe, PayPal)]
    end

    %% User Interfaces
    subgraph User_Interfaces
        direction TB
        Web_App[Web Application<br/>(SPA/PWA)]
        Mobile_App[Mobile Applications<br/>(Future: iOS/Android)]
        Admin_Panel[Admin Panel<br/>(Dashboard, management)]
        Moderator_UI[Moderator Interface<br/>(Queue review)]
    end

    %% Relationships
    %% User Interfaces to Gateways
    Web_App --> APIGateway
    Mobile_App --> APIGateway
    Admin_Panel --> APIGateway
    Moderator_UI --> APIGateway

    %% Gateways to Services
    APIGateway --> Auth_Service
    APIGateway --> User_Profile
    APIGateway --> Animal_Service
    APIGateway --> Listing_Service
    APIGateway --> Moderation_Service
    APIGateway --> Matching_Service
    APIGateway --> Notification_Service
    APIGateway --> Geo_Service
    APIGateway --> Admin_Service
    APIGateway --> Payment_Service

    %% Service Dependencies
    Auth_Service --> User_Profile
    Listing_Service --> Animal_Service
    Listing_Service --> Moderation_Service
    Matching_Service --> Animal_Service
    Matching_Service --> Listing_Service
    Notification_Service --> User_Profile
    Geo_Service --> Animal_Service
    Geo_Service --> Listing_Service

    %% Services to Supporting Infrastructure
    Auth_Service --> Cache_Layer
    User_Profile --> Cache_Layer
    Animal_Service --> Cache_Layer
    Listing_Service --> Cache_Layer
    Moderation_Service --> Cache_Layer
    Matching_Service --> Cache_Layer
    Notification_Service --> Cache_Layer
    Geo_Service --> Cache_Layer
    Admin_Service --> Cache_Layer
    Payment_Service --> Cache_Layer

    Auth_Service --> Event_Bus
    Listing_Service --> Event_Bus
    Moderation_Service --> Event_Bus
    Animal_Service --> Event_Bus
    Notification_Service --> Event_Bus

    Auth_Service --> Search_Engine
    Listing_Service --> Search_Engine
    Animal_Service --> Search_Engine

    %% Services to File Storage
    Listing_Service --> File_Storage
    User_Profile --> File_Storage
    Animal_Service --> File_Storage

    %% Data Layer Connections
    Auth_Service --> Primary_DB
    User_Profile --> Primary_DB
    Animal_Service --> Primary_DB
    Listing_Service --> Primary_DB
    Moderation_Service --> Primary_DB
    Matching_Service --> Primary_DB
    Notification_Service --> Primary_DB
    Geo_Service --> Primary_DB
    Admin_Service --> Primary_DB
    Payment_Service --> Primary_DB

    %% Replication and Backup
    Primary_DB --> Replica_DB
    Primary_DB --> Archive_DB

    %% External Integrations
    Auth_Service --> SMS_Gateway
    Auth_Service --> OAuth_Providers
    Notification_Service --> SMS_Gateway
    Notification_Service --> Email_Service
    Geo_Service --> Maps_Service
    Payment_Service --> Payment_Gateways
    File_Storage --> Maps_Service

    %% Monitoring
    Monitoring .-> Auth_Service
    Monitoring .-> User_Profile
    Monitoring .-> Animal_Service
    Monitoring .-> Listing_Service
    Monitoring .-> Moderation_Service
    Monitoring .-> Matching_Service
    Monitoring .-> Notification_Service
    Monitoring .-> Geo_Service
    Monitoring .-> Admin_Service
    Monitoring .-> Payment_Service
    Monitoring .-> APIGateway
    Monitoring .-> Cache_Layer
    Monitoring .-> Primary_DB
    Monitoring .-> File_Storage
    Monitoring .-> Search_Engine

    classDef service fill:#E3F2FD,stroke:#1565C0,stroke-width:1px;
    classDef storage fill:#FFF3E0,stroke:#EF6C00,stroke-width:1px;
    classDef external fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1px;
    classDef ui fill:#E8F5E8,stroke:#2E7D32,stroke-width:1px;
    classDef support fill:#F5F5F5,stroke:#616161,stroke-width:1px;
    classDef data fill:#FFEBEE,stroke:#C62828,stroke-width:1px;
    classDef monitoring fill:#FFFDE7,stroke:#F57F17,stroke-width:1px;

    class Auth_Service,User_Profile,Animal_Service,Listing_Service,Moderation_Service,Matching_Service,Notification_Service,Geo_Service,Admin_Service,Payment_Service service;
    class File_Storage,Search_Engine,Cache_Layer storage;
    class SMS_Gateway,Email_Service,Maps_Service,OAuth_Providers,Payment_Gateways external;
    class Web_App,Mobile_App,Admin_Panel,Moderator_UI ui;
    class APIGateway,Web_Gateway,Event_Bus support;
    class Primary_DB,Replica_DB,Archive_DB data;
    class Monitoring monitoring;
```

## Component Descriptions

### Core Business Services
- **Authentication Service**: Handles user authentication (phone/OAuth), JWT generation/validation, session management
- **User Profile Service**: Manages user profiles, preferences, settings, and user-organization relationships
- **Animal Service**: Core animal entity management including lifecycle, ownership, pedigree, and health data
- **Listing Service**: Manages listing lifecycle, search functionality, moderation workflow, and transaction states
- **Moderation Service**: Queue management, decision workflow, audit trails, and moderator assignment
- **Matching Service**: Compatibility algorithms for breeding matches based on genetics, location, and preferences
- **Notification Service**: Handles all outbound communications (email, SMS, push notifications)
- **Geo Service**: Spatial indexing, distance calculations, and geo-search optimizations
- **Admin Service**: System configuration, reference data management (breeds, species), and administrative functions
- **Payment Service**: Placeholder for future payment processing (escrow, subscriptions, fees)

### Supporting Infrastructure
- **API Gateway**: Entry point handling routing, authentication, rate limiting, and request/response transformation
- **Web Gateway**: Server-side rendering, asset serving, and SEO optimization for web crawlers
- **File Storage Service**: Abstracts object storage operations (S3-compatible) with CDN integration
- **Search Engine**: Provides full-text search capabilities for listings and animal profiles
- **Cache Layer**: Distributed caching for frequently accessed data (sessions, reference data, computed results)
- **Event Bus**: Enables loose coupling between services through pub/sub messaging patterns
- **Monitoring & Observability**: Collects metrics, logs, and traces for system health and performance analysis

### Data Layer
- **Primary Database**: Main PostgreSQL instance handling all read/write operations
- **Replica Database**: Read replicas for scaling read-heavy operations and analytics
- **Archive Storage**: Long-term backup storage for compliance and disaster recovery

### External Systems
- **SMS Provider**: Third-party service for sending verification codes and notifications
- **Email Provider**: Third-party service for transactional and marketing emails
- **Maps Provider**: Geocoding and mapping service for location-based features
- **OAuth Providers**: Third-party identity providers for social login options
- **Payment Gateways**: Future integration with payment processors for financial transactions

### User Interfaces
- **Web Application**: Single Page Application with PWA capabilities for browser access
- **Mobile Applications**: Native iOS/Android applications (planned for future phases)
- **Admin Panel**: Administrative dashboard for system configuration and user management
- **Moderator Interface**: Specialized interface for moderators to review and decide on listings

## Interface Contracts

### Synchronous Interfaces (REST/gRPC)
- All core services expose RESTful APIs over HTTPS
- Internal service-to-service communication uses gRPC for performance-critical paths
- API Gateway handles protocol translation and load balancing

### Asynchronous Interfaces (Event-Driven)
- Services publish domain events to Event Bus for loose coupling
- Examples: AnimalCreated, ListingPublished, ModerationDecisionMade, MatchFound
- Enables eventual consistency and workflow orchestration

### Data Access Patterns
- Services access databases through ORM/repositories with connection pooling
- Read-heavy operations can use replica databases
- Cache-aside pattern for frequently accessed data
- Write-through caching for session data

## Deployment Considerations
- Services can be deployed independently or as a monolith
- Container orchestration via Kubernetes (EKS/GKE/self-managed)
- Database per service pattern possible for future microservices evolution
- Service mesh (Istio/Linkerd) can manage inter-service communication
- Blue-green deployments supported for zero-downtime releases