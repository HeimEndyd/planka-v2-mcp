# Change: Add multi-account HTTP identities

## Why

The centralized HTTP server currently accepts one client bearer and uses one global Planka
credential. Multiple trusted clients need independent Planka permissions and independently
revocable MCP credentials without running one container per account.

## What Changes

- Add a file-backed identity descriptor that maps independent MCP bearer secret files to
  independent Planka credential secret files.
- Resolve an immutable identity before parsing JSON-RPC and bind every MCP request to its own
  Planka client context.
- Remove module-global Planka access-token state.
- Add a safe `mcp_kanban_whoami` tool and metadata-only request audit records.
- Preserve the existing single-account environment configuration and STDIO behavior.

## Impact

- Affected specs: `streamable-http-transport`, `file-backed-secrets`, new
  `multi-account-identities` capability.
- Affected code: HTTP transport, server factory, Planka request client, attachment resources,
  Docker deployment configuration, tests, and documentation.
