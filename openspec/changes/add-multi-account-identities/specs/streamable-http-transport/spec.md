# Streamable HTTP transport delta

## MODIFIED Requirements

### Requirement: HTTP requests require an accepted bearer on public binds

The HTTP transport SHALL authenticate public requests against either the legacy single bearer or
the configured multi-account identity registry before reading JSON-RPC.

#### Scenario: Unknown multi-account bearer

- **WHEN** a request supplies a bearer not present in the identity registry
- **THEN** the server returns HTTP 401 before JSON parsing
- **AND** the response does not disclose configured identity IDs
