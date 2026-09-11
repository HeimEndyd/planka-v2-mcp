# Multi-account identities

## ADDED Requirements

### Requirement: Bearer selects exactly one server-side identity

The HTTP server SHALL map each accepted MCP bearer to exactly one immutable identity and its own
Planka client. JSON-RPC arguments SHALL NOT select or override the identity.

#### Scenario: Two clients use different Planka accounts

- **WHEN** two requests use bearer tokens belonging to different identities
- **THEN** each request uses only its identity's Planka credential
- **AND** `mcp_kanban_whoami` returns different identity and Planka user IDs

#### Scenario: Requests execute concurrently

- **WHEN** operations and attachment downloads overlap across identities
- **THEN** API keys, cached password tokens, and download authentication remain isolated

### Requirement: Identity configuration fails closed

The server SHALL validate the complete identity descriptor and all referenced secret files before
listening.

#### Scenario: Descriptor is ambiguous or incomplete

- **WHEN** IDs or bearer values are duplicated, a bearer is short, a secret is unreadable, or an
  identity combines API-key and password modes
- **THEN** startup fails without logging secret values

#### Scenario: Legacy and identity modes are mixed

- **WHEN** `MCP_HTTP_IDENTITIES_FILE` and any legacy bearer or Planka credential variable are set
- **THEN** startup fails instead of selecting a precedence

### Requirement: Identity metadata is safe to expose and audit

The server SHALL expose only non-secret identity/account metadata and SHALL audit requests without
headers or full arguments.

#### Scenario: Authenticated caller invokes whoami

- **WHEN** a valid identity invokes `mcp_kanban_whoami`
- **THEN** the response includes identity ID, Planka user ID, auth mode, and safe account fields
- **AND** no bearer, API key, password, or access token is returned
