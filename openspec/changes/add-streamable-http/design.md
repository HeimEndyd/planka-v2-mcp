## Context

The current entry point creates one `McpServer`, registers the complete tool/resource surface, and
connects it directly to STDIO. The same registrations must be available to both local package users
and a centrally deployed HTTP service. Current operations are request/response based and do not use
subscriptions, server notifications, resumability, or other per-session state.

## Goals / Non-Goals

**Goals:**

- Preserve the existing STDIO contract and all tool/resource names.
- Provide modern Streamable HTTP suitable for a reverse-proxied service.
- Keep client authentication independent from Planka authentication.
- Reject unauthenticated or invalid requests before parsing their bodies.
- Make the container reproducible, non-root, and health-checkable.

**Non-Goals:**

- OAuth/OIDC authorization or per-client scopes.
- Stateful MCP sessions, server notifications, or legacy HTTP+SSE.
- Embedding the MCP server in the Planka process or reading its database directly.

## Decisions

### Build a fresh server for every stateless request

`createPlankaMcpServer()` owns all tool and resource registration. HTTP POST requests each receive a
new `McpServer` and `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`. This avoids
a session map, inactivity TTL, sticky routing, and stale state across container restarts. STDIO
creates the same server once and connects it to `StdioServerTransport`.

### Keep STDIO as the default

The executable selects HTTP only through `--transport=http` or `MCP_TRANSPORT=http`. With no option
it behaves exactly as the published package did before this change. This is both backwards
compatibility and an immediate rollback path.

### Authenticate in the application

HTTP mode compares `Authorization: Bearer ...` against a configured secret using SHA-256 digests and
`timingSafeEqual`. Authentication happens before body collection. The bearer is mandatory on any
non-loopback bind. It is distinct from `PLANKA_API_KEY`, which is sent only upstream as `X-Api-Key`.

### Make configuration fail closed

Each secret accepts either its direct environment variable or a matching `_FILE` variable, never
both. Empty and unreadable secret files fail startup. HTTP body size, bind address, port, allowed
Hosts, and allowed Origins are validated once at startup. Origin is optional for non-browser MCP
clients, but any supplied Origin must be explicitly allowlisted.

### Use Node HTTP directly

The adapter uses Node's built-in HTTP server and passes a bounded, pre-parsed JSON body to the SDK
transport. This avoids adding an application framework solely for one endpoint and makes it possible
to enforce the body limit before JSON parsing.

## Risks / Trade-offs

- Stateless mode cannot provide resumability or server-initiated notifications; adding either
  requires a separate stateful-session design with TTL and limits.
- One shared client bearer has coarse revocation and audit semantics; multiple trust domains should
  move to per-client keys or a conforming OAuth authorization server.
- An exact reverse-proxy route such as `/mcp` can collide with a future Planka route and must be
  checked during Planka upgrades.
