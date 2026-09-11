# Streamable HTTP transport delta

## MODIFIED Requirements

### Requirement: HTTP requests require a validated bearer

The HTTP transport SHALL authenticate requests before reading JSON-RPC. Default passthrough mode
SHALL validate the bearer as a Planka user API key; managed mode SHALL match the legacy single
bearer or configured identity registry.

#### Scenario: Invalid passthrough API key

- **WHEN** Planka rejects the supplied bearer as an API key
- **THEN** the server returns HTTP 401 before JSON parsing
- **AND** the response does not disclose upstream error details

#### Scenario: Unknown multi-account bearer

- **WHEN** a request supplies a bearer not present in the identity registry
- **THEN** the server returns HTTP 401 before JSON parsing
- **AND** the response does not disclose configured identity IDs
