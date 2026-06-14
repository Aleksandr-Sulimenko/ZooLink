# Standard Error Response Format

## Overview
This document defines the standard JSON error response format for all API endpoints in the ZooLink system, along with error code ranges, specific error codes for common validation failures, and correlation ID usage for request tracing.

## Standard JSON Error Response Format
All error responses from the API must follow this structure:

```json
{
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<Human-readable error message>",
    "details": [                 // Optional: Array of specific error details
      {
        "field": "<field_name>", // Optional: For validation errors, the field that failed
        "code": "<VALIDATION_SUB_CODE>",
        "message": "<Field-specific error message>"
      }
    ],
    "correlationId": "<unique_request_identifier>", // For tracing requests across services
    "timestamp": "<ISO_8601_timestamp>",           // Time of error occurrence
    "path": "<API_endpoint_path>"                  // The endpoint that generated the error
  }
}
```

### Field Descriptions
- **error.code**: Top-level error code from the defined ranges (see below)
- **error.message**: General description of the error (suitable for display to users)
- **error.details**: Optional array providing granular details, especially for validation errors
- **error.correlationId**: Unique identifier for the request, used for tracing in logs
- **error.timestamp**: Timestamp when the error occurred (UTC, ISO 8601 format)
- **error.path**: The API endpoint path that triggered the error

## Error Code Ranges
| Range | Description | Example Use Cases |
|-------|-------------|-------------------|
| 4000-4999 | Client Errors | Validation failures, authentication issues, bad requests |
| 5000-5999 | Server Errors | Internal server errors, service unavailable, database failures |

## Common Error Codes

### Client Errors (4000-4999)
| Code | Message | Details | Scenario |
|------|---------|---------|----------|
| 4000 | Bad Request | Validation errors in request payload | Malformed JSON, missing required fields |
| 4001 | Unauthorized | Authentication required | Missing or invalid authentication token |
| 4002 | Forbidden | Insufficient permissions | User lacks role/permission for action |
| 4003 | Not Found | Resource not found | Requested animal/listing/user does not exist |
| 4004 | Method Not Allowed | HTTP method not supported | Using POST on a read-only endpoint |
| 4005 | Conflict | Resource state conflict | Attempting to sell an animal already marked as sold |
| 4006 | Validation Failed | Input validation errors | See validation subcodes below |
| 4007 | Rate Limit Exceeded | Too many requests | User has exceeded allowed request rate |
| 4008 | Listing Expired | Listing no longer active | Attempting to purchase an expired listing |
| 4009 | Insufficient Funds | Payment required | User attempts purchase without adequate balance/payment method |
| 4010 | Geo-search Invalid Radius | Radius out of bounds | Requested search radius <1km or >100km |

### Validation Failed Subcodes (when error.code = 4006)
| Subcode | Field | Message | Scenario |
|---------|-------|---------|----------|
| 4006-001 | price | Price must be greater than zero | Price ≤ 0 |
| 4006-002 | title | Title must be between 3 and 100 characters | Title too short/long |
| 4006-003 | description | Description must not exceed 5000 characters | Description too long |
| 4006-004 | location | Invalid location format | Latitude/longitude out of valid range |
| 4006-005 | animalId | Invalid animal ID format | Not a valid UUID |
| 4006-006 | species | Species not supported | Species not in allowed list |
| 4006-007 | breed | Breed not valid for selected species | Breed mismatch |
| 4006-008 | age | Age must be positive and within species limits | Age too high/low |
| 4006-009 | contactPhone | Invalid phone number format | Does not match expected pattern |
| 4006-010 | email | Invalid email format | Not a valid email address |
| 4006-011 | mediaUrls | Must provide at least one image | No media URLs provided |
| 4006-012 | mediaUrls | Maximum 10 media items allowed | More than 10 URLs provided |
| 4006-013 | radius | Radius must be between 1 and 100 kilometers | Invalid geo-search radius |
| 4006-014 | verificationCode | Invalid or expired verification code | Code mismatch or expired |
| 4006-015 | password | Password does not meet complexity requirements | Too short, missing character types |

### Server Errors (5000-5999)
| Code | Message | Details | Scenario |
|------|---------|---------|----------|
| 5000 | Internal Server Error | Unexpected condition | Generic catch-all for unhandled exceptions |
| 5001 | Service Unavailable | Temporary overload or maintenance | Downstream service dependency failing |
| 5002 | Database Error | Database operation failed | Connection timeout, constraint violation |
| 5003 | Search Index Error | Search service unavailable | Elasticsearch/OpenSearch cluster issues |
| 5004 | Message Queue Error | Event publishing failed | RabbitMQ/Kafka connection issues |
| 5005 | External Service Error | Third-party API failure | SMS gateway, geocoding service down |
| 5006 | Configuration Error | Missing or invalid configuration | Required env var not set |
| 5007 | Not Implemented | Feature not yet available | Endpoint exists but logic not implemented |
| 5008 | Timeout | Request processing took too long | Upstream timeout or long-running operation |
| 5009 | Concurrency Conflict | Simultaneous modification detected | Optimistic lock failure on update |

## Correlation ID Usage
### Generation
- Each incoming request must be assigned a unique correlation ID at the entry point (API gateway or first microservice).
- Format: UUIDv4 (e.g., "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8")
- If the incoming request already contains a correlation ID (via `X-Correlation-ID` header), it should be propagated; otherwise, generate a new one.

### Propagation
- The correlation ID must be included in:
  - All outgoing HTTP requests to other services (as `X-Correlation-ID` header)
  - All log statements related to the request
  - Error responses (in the `error.correlationId` field)
  - Metrics and traces (if using APM tools)

### Storage and Logging
- Log entries must include the correlation ID in a structured format (e.g., JSON logs) to enable filtering and tracing.
- Example log entry:
  ```json
  {
    "timestamp": "2026-06-13T10:30:00.000Z",
    "level": "ERROR",
    "message": "Failed to validate listing price",
    "correlationId": "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8",
    "service": "listing-service",
    "endpoint": "/listings",
    "errorCode": "4006-001"
  }
  ```

### Benefits
- Enables end-to-end tracing of a request across multiple services.
- Simplifies debugging by allowing operators to find all logs related to a single user action.
- Facilitates monitoring and alerting on error rates per correlation ID (if needed).

## Implementation Guidelines
1. **Middleware Approach**: Implement error formatting and correlation ID injection as middleware at the API gateway or service entry point.
2. **Consistent Use**: All services must adhere to this format; no ad-hoc error responses.
3. **Localization**: The `message` field should be localized based on the `Accept-Language` header (see localization specifications).
4. **Security**: Avoid leaking sensitive information in error messages (e.g., database connection details).
5. **Testing**: Unit and integration tests must verify error responses match this format.
6. **Documentation**: Include example error responses in OpenAPI/Swagger documentation for each endpoint.

## Example Error Responses

### Validation Error (4006)
```json
{
  "error": {
    "code": "4006",
    "message": "Input validation failed",
    "details": [
      {
        "field": "price",
        "code": "4006-001",
        "message": "Price must be greater than zero"
      },
      {
        "field": "title",
        "code": "4006-002",
        "message": "Title must be between 3 and 100 characters"
      }
    ],
    "correlationId": "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8",
    "timestamp": "2026-06-13T10:30:00.000Z",
    "path": "/api/v1/listings"
  }
}
```

### Authentication Error (4001)
```json
{
  "error": {
    "code": "4001",
    "message": "Authentication required",
    "correlationId": "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8",
    "timestamp": "2026-06-13T10:30:00.000Z",
    "path": "/api/v1/listings"
  }
}
```

### Internal Server Error (5000)
```json
{
  "error": {
    "code": "5000",
    "message": "Internal server error",
    "correlationId": "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8",
    "timestamp": "2026-06-13T10:30:00.000Z",
    "path": "/api/v1/listings"
  }
}
```