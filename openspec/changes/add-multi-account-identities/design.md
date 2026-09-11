# Design: Multi-account bearer identities

## Context

The HTTP transport is stateless, but Planka authentication was process-global. Adding multiple
accepted bearer strings without changing the upstream client would authenticate every caller as
the same Planka user and a mutable per-request environment switch would race under concurrency.

## Decisions

### Immutable startup registry

`MCP_HTTP_IDENTITIES_FILE` points to a versioned JSON descriptor. The descriptor contains public
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

### Compatibility

Without `MCP_HTTP_IDENTITIES_FILE`, the legacy bearer and `PLANKA_*` variables create one `default`
identity. STDIO creates one `stdio` identity. Identity-file mode rejects all legacy bearer and
upstream credential variables instead of choosing an ambiguous precedence.

### Introspection and audit

`mcp_kanban_whoami` returns only the identity ID, configured Planka user ID, auth mode, and safe
account fields. Audit lines contain identity ID, JSON-RPC method, tool name, outcome, and duration;
they never contain authorization headers or request arguments.

## Trade-offs

- Configuration changes require a controlled container recreate; hot reload is intentionally
  deferred to keep secret rotation atomic and validation fail-closed.
- Password fallback is supported for migration but API keys are preferred because they avoid
  repeated login and isolate revocation at the Planka account.
