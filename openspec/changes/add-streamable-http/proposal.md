## Why

Every client currently launches its own STDIO process, downloads and updates the npm package, and
stores credentials for Planka. A centrally deployed Streamable HTTP server lets operators update
one instance while remote clients need only an HTTPS URL and a separate client bearer token.

## What Changes

- Refactor MCP tool and resource registration into a reusable server factory.
- Add an explicitly selected, stateless Streamable HTTP transport while preserving STDIO as the
  default for existing package users.
- Authenticate HTTP clients with a dedicated bearer token before parsing JSON-RPC input.
- Add bounded request parsing, Host and Origin validation, a health endpoint, and graceful
  shutdown.
- Support Docker-secret style files for both the incoming bearer and the Planka user API key.
- Add a production multi-stage container image and remote-client documentation.

## Capabilities

### New Capabilities

- `streamable-http-transport`: Serve the complete Planka MCP surface over authenticated,
  stateless Streamable HTTP.
- `file-backed-secrets`: Load server credentials from mounted secret files without exposing them
  to clients.

### Modified Capabilities

- `read-only-attachment-content`: Preserve attachment tool and resource behavior across STDIO and
  Streamable HTTP transports.

## Impact

- Adds HTTP configuration and a second transport adapter without changing existing tool names.
- Adds a Docker build intended to run as a non-root service behind a TLS reverse proxy.
- Does not implement OAuth, sessions, subscriptions, legacy SSE, or direct database access.
