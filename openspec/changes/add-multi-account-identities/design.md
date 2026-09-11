# Design: Multi-account bearer identities

## Context

The HTTP transport is stateless, but Planka authentication was process-global. Adding multiple
accepted bearer strings without changing the upstream client would authenticate every caller as
the same Planka user and a mutable per-request environment switch would race under concurrency.

## Decisions

### Default API-key passthrough

Without managed authentication configuration, the HTTP bearer is a Planka user API key. Before
JSON-RPC parsing, the server creates a request-local `PlankaClient`, calls `/api/users/me`, and
rejects an invalid key with the same 401 response as a missing bearer. The validated key is then
used as `X-Api-Key` for API requests and attachment downloads.

This mode stores no account credentials on the MCP server, accepts new Planka accounts without a
configuration change or restart, and lets Planka remain the source of truth for account access and
revocation. The derived audit identity is the authenticated Planka user ID; raw keys are never
logged or returned.

### Opt-in immutable startup registry

Managed mode is selected explicitly or inferred for backwards compatibility when legacy/identity
credentials are configured. `MCP_HTTP_IDENTITIES_FILE` points to a versioned JSON descriptor. It contains public
identity IDs, expected Planka user IDs, and absolute paths to secret files. It never contains raw
tokens or passwords. Startup reads and validates all referenced secrets and rejects the complete
configuration on any error.

### Constant-time multi-token matching

The registry stores SHA-256 bearer digests. A supplied bearer is hashed once and compared against
every configured digest with `timingSafeEqual`; matching does not stop the loop early. Missing,
malformed, and unknown bearers all receive the same 401 response before JSON parsing.

### Request-scoped Planka client

Each identity owns a `PlankaClient`. It contains immutable authentication configuration and, for
password fallback only, an identity-local cached access token. The selected client is bound while
an MCP callback executes. The server factory receives the selected identity explicitly, and
tools/resources cannot select another identity through arguments.

Node `AsyncLocalStorage` carries the already-injected client through the existing operation graph.
This avoids changing the public signature of every operation while remaining safe for concurrent
async requests. Parallel isolation tests are required because this mechanism is security-critical.

### Compatibility and mode selection

`MCP_HTTP_AUTH_MODE` accepts `passthrough` or `managed` and defaults to passthrough when no managed
credentials are present. Existing `MCP_HTTP_IDENTITIES_FILE`, legacy bearer, or legacy `PLANKA_*`
credentials infer managed mode so upgrades remain backwards-compatible. Explicit passthrough mode
rejects managed credentials as ambiguous. STDIO creates one `stdio` identity and is unchanged.

### Introspection and audit

`mcp_kanban_whoami` returns only the identity ID, configured Planka user ID, auth mode, and safe
account fields. Audit lines contain identity ID, JSON-RPC method, tool name, outcome, and duration;
they never contain authorization headers or request arguments.

## Trade-offs

- Passthrough gives the client the full Planka credential, so it can bypass MCP and call Planka
  directly with the same account permissions. Dedicated least-privilege Planka users are required.
- Managed configuration changes require a controlled container recreate; hot reload is
  intentionally deferred to keep secret rotation atomic and validation fail-closed.
- Password fallback is supported for migration but API keys are preferred because they avoid
  repeated login and isolate revocation at the Planka account.
