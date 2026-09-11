## ADDED Requirements

### Requirement: Explicit transport selection

The executable SHALL preserve STDIO as its default and SHALL start Streamable HTTP only when the
operator explicitly selects the HTTP transport.

#### Scenario: Existing package invocation

- **WHEN** the executable starts without a transport option
- **THEN** it connects one server to STDIO with the existing tool and resource surface

#### Scenario: HTTP invocation

- **WHEN** the executable starts with HTTP selected
- **THEN** it listens on the configured address and serves MCP POST requests at `/mcp`

### Requirement: Stateless Streamable HTTP

The HTTP adapter SHALL use the MCP Streamable HTTP transport without server-generated session IDs.

#### Scenario: Independent requests

- **WHEN** two valid MCP POST requests arrive
- **THEN** each request uses a fresh server and transport without shared session state

#### Scenario: Unsupported stream methods

- **WHEN** a client sends GET or DELETE to `/mcp`
- **THEN** the server responds with method not allowed

### Requirement: Client bearer authentication

The HTTP adapter SHALL require a dedicated bearer token on non-loopback binds and compare it in
constant time before reading the request body.

#### Scenario: Missing or invalid bearer

- **WHEN** a request has no bearer or a bearer that does not match the configured client secret
- **THEN** the server returns 401 without parsing JSON-RPC input

#### Scenario: Valid bearer

- **WHEN** a request has the configured bearer
- **THEN** it proceeds to request validation and MCP handling

### Requirement: Bounded HTTP requests

The HTTP adapter SHALL reject unexpected paths, methods, Hosts, Origins, malformed JSON, and bodies
larger than the configured maximum.

#### Scenario: Supplied browser Origin

- **WHEN** an Origin header is present
- **THEN** it is accepted only when its normalized origin is explicitly allowlisted

#### Scenario: Oversized input

- **WHEN** Content-Length or streamed bytes exceed the configured limit
- **THEN** the server returns 413 and does not invoke an MCP handler

### Requirement: Operational lifecycle

The HTTP server SHALL expose an unauthenticated `/healthz` endpoint and close its listener and active
MCP handlers on SIGINT or SIGTERM within a bounded grace period.

#### Scenario: Container health probe

- **WHEN** a GET request is sent to `/healthz`
- **THEN** the server returns a successful JSON response containing its version

#### Scenario: Termination signal

- **WHEN** the process receives SIGINT or SIGTERM
- **THEN** it stops accepting connections, closes active MCP servers, and exits
