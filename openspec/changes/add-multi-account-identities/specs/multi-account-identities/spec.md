# Multi-account identities

## ADDED Requirements

### Requirement: Planka API-key passthrough is the default

When no managed authentication configuration is present, the HTTP server SHALL interpret the
client bearer as a Planka user API key, validate it through `/api/users/me` before JSON-RPC parsing,
and use it as `X-Api-Key` only for that request's API and attachment operations.

#### Scenario: A new Planka account connects

- **WHEN** a client supplies a valid Planka user API key as its MCP bearer
- **THEN** the server accepts the request without an identity descriptor or restart
- **AND** `mcp_kanban_whoami` returns the authenticated Planka user

#### Scenario: A key is missing, invalid, or revoked

- **WHEN** Planka rejects the supplied API key
- **THEN** the MCP server returns HTTP 401 before parsing JSON-RPC
- **AND** no raw key is logged, persisted, or returned

#### Scenario: Validation is unavailable

- **WHEN** Planka cannot validate a supplied key because the upstream is unavailable
- **THEN** the MCP server returns HTTP 503 rather than misreporting the key as invalid

### Requirement: Managed bearer selects exactly one server-side identity

In opt-in managed mode, the HTTP server SHALL map each accepted MCP bearer to exactly one immutable
identity and its own Planka client. JSON-RPC arguments SHALL NOT select or override the identity.

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
