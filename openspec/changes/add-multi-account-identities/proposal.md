# Change: Add multi-account HTTP identities

## Why

The centralized HTTP server currently accepts one client bearer and uses one global Planka
credential. Multiple trusted clients need independent Planka permissions without running one
container per account or registering every account in the server configuration.

## What Changes

- Treat the client's Planka user API key as the HTTP bearer by default, validate it against
  Planka, and pass it upstream as `X-Api-Key` without persisting it on the MCP server.
- Keep the file-backed identity descriptor as an opt-in managed mode when clients must not receive
  the upstream Planka credential or require independent MCP credential revocation.
- Resolve an immutable identity before parsing JSON-RPC and bind every MCP request to its own
  Planka client context.
- Remove module-global Planka access-token state.
- Add a safe `mcp_kanban_whoami` tool and metadata-only request audit records.
- Preserve the existing single-account environment configuration, managed identities, and STDIO
  behavior.

## Impact

- Affected specs: `streamable-http-transport`, `file-backed-secrets`, new
  `multi-account-identities` capability.
- Affected code: HTTP transport, server factory, Planka request client, attachment resources,
  Docker deployment configuration, tests, and documentation.
