# Monitoring and Observability for ZooLink

**Status**: Draft  
**Date**: 2026-06-13  

## Overview

This document outlines the monitoring, logging, tracing, and alerting strategies for the ZooLink platform. Effective observability is crucial for maintaining system health, diagnosing issues, and ensuring performance targets are met, particularly for geo-search (<1s response time) and moderation workflows.

## Goals

1. **System Health**: Detect and diagnose infrastructure and application issues
2. **Performance**: Ensure SLAs are met (geo-search <1s, API response times)
3. **User Experience**: Monitor key user journeys and satisfaction signals
4. **Business Metrics**: Track platform growth, engagement, and conversion
5. **Security**: Detect anomalous behavior and potential threats
6. **Capacity Planning**: Understand resource utilization and scaling needs

## Monitoring Stack

### Metrics Collection
- **Primary**: Prometheus (pull-based metric collection)
- **Alternative**: Cloud monitoring (AWS CloudWatch, Google Monitoring) if using managed services
- **Exporters**:
  - Node Exporter: Host-level metrics (CPU, memory, disk, network)
  - PostgreSQL Exporter: Database metrics (connections, queries, replication lag)
  - Redis Exporter: Cache metrics (hit rate, memory usage, persistence)
  - Custom Application Metrics: Business logic and service-specific metrics
  - NGINX/Ingress Controller Exporter: Request rates, latency, error rates

### Logging
- **Primary**: ELK Stack (Elasticsearch, Logstash, Kibana) or equivalent (EFK with Fluentd)
- **Structured Logging**: JSON format for all service logs
- **Log Levels**: ERROR, WARN, INFO, DEBUG (DEBUG only in development/staging)
- **Log Retention**: 
  - Application logs: 30 days (hot), 90 days (warm/archive)
  - Audit logs: 180 days (compliance requirement)
  - Access logs: 90 days
- **Log Shipping**: 
  - DaemonSet (Fluentd/Fluent Bit) on each node
  - Or sidecar containers for services without direct host access

### Distributed Tracing
- **Primary**: Jaeger or Tempo (depending on backend choice)
- **Instrumentation**: OpenTelemetry SDK in NestJS services
- **Trace Context**: Propagated via HTTP headers (W3C TraceContext)
- **Sampling Strategy**: 
  - 100% of error traces
  - 1% of regular traces (adjustable based on volume)
  - Priority sampling for specific endpoints (geo-search, moderation)

### Visualization and Dashboards
- **Primary**: Grafana (connects to Prometheus, Loki, Tempo)
- **Dashboards**:
  - Infrastructure overview (Cluster, nodes, resource usage)
  - Service-specific (API performance, database, cache)
  - Business metrics (user growth, listing volume, moderation stats)
  - User experience (API latency, error rates, geo-search performance)
  - Security (failed logins, anomalous behavior, rate limiting hits)

### Alerting
- **Primary**: Alertmanager (with Prometheus) or integrated cloud monitoring
- **Notification Channels**:
  - Critical: PagerDuty, SMS, phone calls
  - High: Slack (#alerts-high), Email
  - Medium/Low: Slack (#alerts-medium), Ticketing system (Jira)
- **Alert Grouping**: By service, severity, and symptom to reduce noise
- **Inhibition Rules**: Lower severity alerts suppressed when higher severity alert firing

## Key Metrics to Monitor

### Infrastructure Metrics
- **CPU Utilization**: >80% for 5 minutes (warning), >95% (critical)
- **Memory Utilization**: >85% for 5 minutes (warning), >95% (critical)
- **Disk Space**: <15% free (warning), <5% free (critical)
- **Disk I/O**: High latency or saturated throughput
- **Network**: Packet drops, high latency, bandwidth saturation
- **Kubernetes**: Pod restart rate, CrashLoopBackOff, node readiness

### Database Metrics (PostgreSQL)
- **Connections**: Usage approaching max_connections
- **Replication Lag**: >5 seconds between primary and replica
- **Query Performance**: 
  - Slow queries (>1s execution time)
  - Sequential scans on large tables
  - Lock wait time >50ms
- **Background Writer**: Checkpoints triggered too frequently
- **WAL Storage**: Disk usage for WAL archiving
- **Hit Ratio**: Buffer cache hit ratio <95% (warning)

### Cache Metrics (Redis)
- **Memory Usage**: >80% of maxmemory (warning), >95% (critical)
- **Hit Rate**: <85% for cumulative hits (warning)
- **Evictions**: Keys being evicted due to memory pressure
- **Latency**: 99th percentile command latency >10ms
- **Persistence**: RDB/AOF save failures
- **Replication**: Replica lag >1 second

### Application Metrics (NestJS Services)
- **API Latency**:
  - 95th percentile response time <1s (geo-search SLA)
  - 99th percentile response time <2s
  - Average response time <500ms
- **Error Rates**: 
  - HTTP 5xx errors >1% of total requests (warning)
  - HTTP 4xx errors >5% (may indicate client issues or abuse)
- **Throughput**: Requests per second per service
- **Saturation**: Event loop delay, thread pool usage
- **Business Metrics**:
  - Active users (DAU/WAU/MAU)
  - New listings per day/hour
  - Moderation queue depth and processing time
  - Contact request volume
  - Search conversion rate (search → contact show)
  - Listing publication rate (submitted → published)

### Geo-Search Specific Metrics
- **Response Time**: 95th percentile <1s (SLA)
- **Distance Calculation Accuracy**: Validation against known distances
- **Index Usage**: Percentage of geo queries using spatial index
- **False Positives/Negatives**: In geo-fencing results
- **Cache Effectiveness**: Hit rate for repeated geo-search patterns

### Moderation Workflow Metrics
- **Queue Depth**: Number of PENDING_MODERATION listings
- **Processing Time**: 
  - Average time from submission to decision
  - Percentage within SLA (<4h pet, <6h livestock)
- **Moderator Throughput**: Decisions per moderator per hour
- **Decision Distribution**: Approve vs reject rates
- **Reasons for Rejection**: Top categories (fraud, incomplete, policy violation)
- **Appeal Rate**: Percentage of rejected listings resubmitted and approved

### Security Metrics
- **Authentication**: Failed login attempts (by IP/user)
- **Rate Limiting**: Hits per endpoint and IP
- **Token Validation**: Invalid/expired token rates
- **Input Validation**: Malformed requests blocking
- **Anomalous Behavior**: Unusual access patterns, privilege escalation attempts
- **Data Access**: Unauthorized access attempts to sensitive endpoints

## Logging Strategy

### Log Structure
All services output structured JSON logs with consistent fields:
```json
{
  "timestamp": "2026-06-13T10:30:00.123Z",
  "level": "INFO",
  "service": "listings-service",
  "instance": "listings-service-7d9c5f6b6-2k8mn",
  "trace_id": "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8",
  "span_id": "b2c3d4e5-f6g7-8901-h2i3-j4k5l6m7n8o9",
  "message": "Listing created successfully",
  "listing_id": "lst_12345",
  "user_id": "usr_67890",
  "duration_ms": 145
}
```

### Log Categories
1. **Application Logs**: Business logic, request/response, errors
2. **Access Logs**: HTTP requests (via middleware or ingress controller)
3. **Audit Logs**: Security-relevant events (authentication, authorization, data changes)
4. **Error Logs**: Exceptions and stack traces
5. **Performance Logs**: Slow query warnings, timeout alerts

### Log Levels
- **ERROR**: Something went wrong requiring immediate attention
- **WARN**: Something unexpected happened but service can continue
- **INFO**: Normal operational messages
- **DEBUG**: Detailed information for troubleshooting (dev/staging only)

### Specialized Logging
- **Access Logging**: Combined format with response time, status, user agent
- **Audit Logging**: Immutable append-only log for compliance (GDPR, financial)
- **Event Logging**: Business events for analytics (listing published, user registered)
- **Security Logging**: Authentication failures, permission denials, suspicious patterns

## Distributed Tracing

### Trace Context Propagation
- HTTP headers: `traceparent`, `tracestate` (W3C TraceContext)
- gRPC metadata: `grpc-trace-bin`
- Message queue properties: tracing headers on messages

### Instrumentation Points
- **HTTP Layer**: Incoming request to outgoing response
- **Database Calls**: Query execution time and parameters (sanitized)
- **External API Calls**: Outgoing HTTP requests to third parties
- **Message Queue**: Publish and consume operations
- **Cache Operations**: GET/SET/DEL with key and timing
- **Business Logic Boundaries**: Service method entries/exits

### Trace Attributes
- Service name and version
- Operation name (HTTP method + path, DB query type)
- Error information (if span ended with exception)
- Custom attributes: user_id, listing_id, request_id
- Links to related traces (for fan-out/fan-in patterns)

### Trace Storage and Retention
- **Hot Storage**: Recent traces (last 48 hours) for immediate troubleshooting
- **Warm Storage**: Traces from last 7 days for trend analysis
- **Cold Storage**: Traces from last 30 days for compliance and deep investigation
- **Sampling**: Adaptive sampling based on traffic volume and error rates

## Alerting Strategy

### Alert Severity Levels
- **Critical (Pager)**: System down, major functionality unavailable, data loss risk
- **High (Ticket + Notification)**: Degraded performance, SLA at risk, manual intervention needed
- **Medium (Notification)**: Anomalies requiring investigation, capacity warnings
- **Low (Log Only)**: Informational, tracking, trend analysis

### Key Alerts

#### Infrastructure Alerts
- **NodeDown**: Kubernetes node not Ready for 5 minutes
- **PodCrashLooping**: Pod restarting >5 times in 10 minutes
- **DiskFull**: Filesystem usage >90%
- **MemoryPressure**: Node memory usage >90%
- **CPUThrottling**: Container CPU throttling >10% of period

#### Database Alerts
- **PostgresReplicationLag**: Replica lag >10 seconds
- **PostgresConnectionsUsage**: Used connections >85% of max_connections
- **PostgresSlowQueries**: Query execution time >5s (rate >0.1/s)
- **PostgresLockWaitTime**: Average lock wait time >100ms

#### Redis Alerts
- **RedisMemoryUsage**: Used memory >85% of maxmemory
- **RedisHitRate**: Cache hit rate <80% over 5 minutes
- **RedisFailedPersistence**: RDB/AOF save failure
- **RedisReplicationLag**: Replica lag >2 seconds

#### Application Alerts
- **APIHighLatency**: 95th percentile API response time >2s
- **APIErrorRate**: HTTP 5xx error rate >2% over 5 minutes
- **APIDown**: Health check failures >3 consecutive checks
- **ModerationQueueDepth**: >100 listings in PENDING_MODERATION for >1 hour
- **GeoSearchSLAViolation**: 95th percentile geo-search response time >1.5s
- **ModerationSLAPetViolation**: >20% of pet listings exceed 4h moderation time
- **ModerationSLALivestockViolation**: >20% of livestock listings exceed 6h moderation time

#### Security Alerts
- **BruteForceAuth**: >10 failed logins from same IP in 5 minutes
- **RateLimitHit**: IP hitting rate limit >100 times in 5 minutes
- **SuspiciousEndpointAccess**: Access to admin endpoints by non-admin users
- **DataExfiltrationPattern**: Unusual volume of data requests from single user

### Alert Management
- **Silences**: Planned maintenance windows
- **Inhibition**: Lower severity alerts silenced when critical alert firing
- **Dependencies**: Alerts suppressed if upstream dependency alert firing
- **Runbooks**: Each alert links to troubleshooting documentation
- **Auto-Resolution**: Alerts automatically resolve when condition clears

## Dashboard Overview

### Executive Dashboard
- **Purpose**: High-level platform health for stakeholders
- **Metrics**: 
  - Uptime percentage (monthly)
  - Active users and growth trends
  - Listing volume and categorization
  - Moderation efficiency (queue depth, processing time)
  - System performance (API latency, error rates)
  - Key business metrics (conversion rates, user satisfaction)

### Infrastructure Dashboard
- **Purpose**: Cluster and node-level health
- **Metrics**:
  - Node resource utilization (CPU, memory, disk, network)
  - Pod status and resource requests/limits
  - Network throughput and packet loss
  - Storage performance and utilization
  - Kubernetes-specific metrics (scheduler, controller manager)

### Service Dashboards (per service)
- **Purpose**: Deep dive into individual service health
- **Metrics**:
  - Service-specific API latency and error rates
  - Database and cache dependency performance
  - External API call success rates and latency
  - Queue depth and processing lag (if applicable)
  - Business logic metrics (transactions processed, etc.)
  - Resource utilization (CPU, memory, file descriptors)

### Business Dashboard
- **Purpose**: User engagement and platform growth
- **Metrics**:
  - User registration and activation funnels
  - Listing creation by category (pet/livestock, type)
  - Search volume and popular queries/filters
  - Contact request volume and conversion to off-platform communication
  - Moderation statistics (volume, turnaround time, reject reasons)
  - Geographic distribution of users and listings
  - Retention and engagement metrics (DAU/WAU/MAU)

### Geo-Search Dashboard
- **Purpose**: Performance and effectiveness of geo-search functionality
- **Metrics**:
  - Response time distribution (percentiles over time)
  - Index usage and efficiency
  - Distance calculation accuracy (validation samples)
  - Query patterns (popular search radii, locations)
  - Cache hit rates for geo-search
  - False positive/negative rates (if validation data available)

### Moderation Dashboard
- **Purpose**: Efficiency and quality of moderation process
- **Metrics**:
  - Queue depth over time (pet vs livestock)
  - Processing time distribution (percentiles)
  - Moderator throughput and workload distribution
  - Decision outcomes (approve/reject ratios)
  - Reasons for rejection (top categories)
  - Re-submission and appeal rates
  - SLA compliance (percentage within time targets)
  - Moderator performance (if individually tracked)

### Security Dashboard
- **Purpose**: Detection of threats and anomalous behavior
- **Metrics**:
  - Authentication success/failure rates
  - Rate limiting triggers by endpoint and IP
  - Suspicious access patterns (privilege escalation, probing)
  - Input validation errors (malformed requests)
  - Token validation issues (expired, invalid, malformed)
  - Geographic anomalies (impossible travel, VPN/Tor usage)
  - Data access patterns (unusual volume or timing)

## Implementation Approach

### Phase 1: Core Observability (MVP)
- **Metrics**: Basic Prometheus exporters for services, infrastructure
- **Logging**: Structured JSON logs shipped to Elasticsearch/Filebeat
- **Tracing**: OpenTelemetry instrumentation with Jaeger backend
- **Alerting**: Critical infrastructure and SLA alerts
- **Dashboards**: Grafana with infrastructure, service, and business views

### Phase 2: Enhanced Observability (Post-MVP)
- **Metrics**: Custom business metrics, advanced aggregations
- **Logging**: Audit log enrichment, specialized event logging
- **Tracing**: Distributed tracing for message queues and background jobs
- **Alerting**: ML-based anomaly detection, predictive alerts
- **Dashboards**: Executive, security, and specialized domain views
- **Profiling**: Continuous profiling for performance optimization

### Phase 3: Predictive Observability (Future)
- **Metrics**: Predictive scaling based on historical patterns
- **Logging**: Log analysis for anomaly detection and forecasting
- **Tracing**: Service mesh integration for automatic telemetry
- **Alerting**: Forecast-based alerting, capacity planning automation
- **Dashboards**: AI-driven insights, automated root cause analysis

## Technology Choices and Rationale

### Prometheus over Alternatives
- **Why**: Pull-based model avoids overwhelming targets, excellent service discovery integration with Kubernetes, powerful query language (PromQL), mature ecosystem
- **Alternatives Considered**: 
  - InfluxDB: Push-based can cause issues under load, less robust service discovery
  - Cloud Monitoring: Vendor lock-in, less flexible for multi-cloud/hybrid
  - Graphite: Older architecture, limited multi-dimensional metrics

### ELK Stack over Alternatives
- **Why**: Mature, scalable, strong community, excellent text search capabilities, flexible parsing/log enrichment
- **Alternatives Considered**:
  - Loki: Cost-effective but less powerful for complex log analysis
  - Cloud Logging: Vendor-specific, less control over retention and indexing
  - Splunk: Excellent but cost-prohibitive for open-source project

### Jaeger over Alternatives
- **Why**: Native OpenTelemetry support, good UI for trace visualization, integrates well with Prometheus/Grafana
- **Alternatives Considered**:
  - Tempo: Cost-effective storage but less mature UI/querying
  - Zipkin: Older, less active community compared to Jaeger
  - Cloud Trace: Vendor-specific, less portable

### Grafana over Alternatives
- **Why**: Excellent visualization, multi-source support (Prometheus, Loki, Tempo), strong alerting, extensive plugin ecosystem
- **Alternatives Considered**:
  - Kibana: Strong for logs but weaker for metrics visualization
  - Superset: Great for business intelligence but less ops-focused
  - Commercial tools: Cost considerations

## Security and Privacy Considerations

### Metrics Security
- **Authentication**: Basic auth or token-based access to Prometheus/Grafana
- **Authorization**: Role-based access control (read-only viewers, operators, admins)
- **Network Security**: Metrics endpoints only accessible within VPC or via VPN
- **Encryption**: TLS for all metrics transmission and storage
- **Data Minimization**: Avoid collecting sensitive data in metrics (PII, credentials)

### Logging Security
- **PII Handling**: 
  - Never log passwords, tokens, or raw PII
  - Hash or tokenize identifiable information when needed for debugging
  - Structured logs allow redacting fields at ingestion time
- **Access Controls**: Role-based access to log data (auditors, security team, developers)
- **Immutability**: Write-once storage for audit logs (WORM storage or append-only)
- **Encryption**: Encryption at rest and in transit for log storage
- **Retention Compliance**: Configurable retention periods for different log types

### Tracing Security
- **Context Propagation**: Ensure trace headers don't leak-sensitive data
- **Sampling**: Avoid sampling sensitive transactions (payment, health data)
- **Access Control**: Restrict trace data to authorized personnel
- **Encryption**: Encrypt trace storage and transmission
- **Data Minimization**: Avoid capturing sensitive payloads in spans (sanitize database queries, HTTP bodies)

### Alerting Security
- **Credential Protection**: Secure storage of notification channel credentials (PagerDuty, Slack webhooks)
- **Access Control**: Limit who can create/modify alerts and silencing rules
- **Audit Trail**: Log all changes to alerting configuration
- **False Positive Reduction**: Tuning to avoid alert fatigue and potential ignoring of real alerts

## Runbooks and Procedures

### Standard Troubleshooting Flow
1. **Alert Received**: Acknowledge in notification system
2. **Initial Triage**: Check dashboard for affected service/system
3. **Metrics Review**: Look for patterns in resource usage, error rates, latency
4. **Log Investigation**: Search structured logs for error messages and trace IDs
5. **Tracing Analysis**: Follow trace through services to identify bottleneck/failure point
6. **Root Cause Identification**: Determine underlying issue (code, config, infrastructure)
7. **Mitigation**: Apply fix, rollback, or scale resources as needed
8. **Communication**: Update stakeholders on status and expected resolution time
9. **Post-Incident**: Conduct blameless post-mortem, update documentation

### Specific Runbooks
- **High API Latency**: Check database query performance, cache hit rates, external API dependencies
- **Moderation Queue Backlog**: Check moderator availability, review SLA compliance, consider temporary additional moderators
- **Geo-Search Performance Degradation**: Verify index usage, check distance calculation library, validate coordinate data quality
- **Database Connection Exhaustion**: Identify leaking connections, check connection pool settings, consider pool resizing
- **Cache Miss Storm**: Review key patterns, check TTL configurations, assess memory pressure
- **Disk Space Critical**: Identify large logs or temporary files, implement log rotation, expand storage
- **Security Alert (Brute Force)**: Block offending IP, review authentication logs, consider additional rate limiting
- **Failed Deployment**: Check pod logs, verify image correctness, validate environment variables and secrets

### Maintenance Procedures
- **Log Rotation**: Configure logrotate or use lifecycle policies in storage backend
- **Metric Retirement**: Remove unused metrics to reduce cardinality pressure
- **Trace Sampling Adjustment**: Adjust rates based on traffic volume and troubleshooting needs
- **Dashboard Review**: Quarterly review of dashboard relevance and effectiveness
- **Alert Tuning**: Regular review of alert thresholds and notification routing

## Related Decisions

- **ADR-0001**: Tech stack choice (influences language runtime and observability library availability)
- **ADR-0002**: Hard split markets (affects how metrics are segmented by domain)
- **ADR-0003**: Pre-Moderation Workflow (key user journey for monitoring and alerting)
- **ADR-0004**: Animal-as-aggregate (impacts how listing and animal data are correlated in traces)
- **ADR-0005**: No chat in MVP (contact sharing replaces chat for communication monitoring)
- **Architecture**: Microservices-ready modular monolith affects service boundaries for monitoring
- **Non-Functional Requirements**: Performance (<1s geo-search), security, and accessibility targets drive specific metrics

## References

- Prometheus Documentation: https://prometheus.io/docs/introduction/overview/
- ELK Stack Guide: https://www.elastic.co/guide/en/elk-stack/current/index.html
- Jaeger Documentation: https://www.jaegertracing.io/docs/
- Grafana Documentation: https://grafana.com/docs/
- OpenTelemetry: https://opentelemetry.io/
- Kubernetes Monitoring: https://kubernetes.io/docs/tasks/debug-application-cluster/resource-metrics-pipeline/
- Observability Engineering: https://www.oreilly.com/library/view/observability-engineering/9781492055831/
- Site Reliability Engineering: https://sre.google/sre-book/table-of-contents/
