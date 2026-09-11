# File-backed secrets delta

## ADDED Requirements

### Requirement: Identity descriptors reference separate secret files

An identity descriptor SHALL contain only absolute secret-file paths and non-secret metadata.

#### Scenario: Production identity uses an API key

- **WHEN** an identity is configured for API-key authentication
- **THEN** its MCP bearer and Planka API key are read from distinct files
- **AND** raw values are absent from the descriptor

#### Scenario: Migration identity uses password authentication

- **WHEN** an identity is configured with email and password files
- **THEN** both files are required and API-key configuration is forbidden for that identity
