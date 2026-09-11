# File-backed secrets delta

## ADDED Requirements

### Requirement: Default passthrough stores no account secret

The default HTTP mode SHALL receive the Planka API key from the client's bearer header and SHALL
not require a server-side bearer, API-key file, password file, or identity descriptor.

#### Scenario: Passthrough server starts

- **WHEN** no managed credential variables are configured
- **THEN** the server starts in passthrough mode
- **AND** each request is validated by Planka before JSON-RPC parsing

### Requirement: Identity descriptors reference separate secret files

An identity descriptor SHALL contain only absolute secret-file paths and non-secret metadata.

#### Scenario: Production identity uses an API key

- **WHEN** an identity is configured for API-key authentication
- **THEN** its MCP bearer and Planka API key are read from distinct files
- **AND** raw values are absent from the descriptor

#### Scenario: Migration identity uses password authentication

- **WHEN** an identity is configured with email and password files
- **THEN** both files are required and API-key configuration is forbidden for that identity
