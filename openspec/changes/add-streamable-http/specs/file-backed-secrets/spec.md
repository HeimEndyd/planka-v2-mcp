## ADDED Requirements

### Requirement: File-backed server secrets

The system SHALL accept the Planka API key, fallback agent login values, and HTTP client bearer
from either their direct environment variables or corresponding `_FILE` variables.

#### Scenario: Mounted secret file

- **WHEN** only `PLANKA_API_KEY_FILE` or `MCP_HTTP_BEARER_TOKEN_FILE` is configured
- **THEN** the trimmed, non-empty file content is used as the corresponding secret

#### Scenario: Conflicting secret sources

- **WHEN** both the direct and file variable for one secret are configured
- **THEN** startup or first use fails with a configuration error that contains no secret value

#### Scenario: Missing required client bearer

- **WHEN** HTTP binds to a non-loopback address without a client bearer
- **THEN** startup fails closed

### Requirement: Independent credentials

The system SHALL treat client-to-MCP credentials and MCP-to-Planka credentials as separate values
with separate configuration names.

#### Scenario: Upstream Planka request

- **WHEN** the server authenticates an API request to Planka with a configured user API key
- **THEN** it sends the API key only as `X-Api-Key` to the configured Planka origin

#### Scenario: MCP response or log

- **WHEN** an HTTP request succeeds or fails
- **THEN** neither configured secret is included in response content or server logs
