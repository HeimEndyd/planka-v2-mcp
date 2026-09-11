## 1. Server Architecture

- [x] 1.1 Refactor complete tool/resource registration into a reusable server factory.
- [x] 1.2 Preserve the existing STDIO entry point as the default transport.
- [x] 1.3 Add stateless Streamable HTTP with `/mcp` and `/healthz` endpoints.

## 2. Security and Configuration

- [x] 2.1 Add file-backed secret loading with direct/file conflict validation.
- [x] 2.2 Add constant-time bearer authentication before body parsing.
- [x] 2.3 Add request body, Host, Origin, method, and path validation.
- [x] 2.4 Add signal handling and bounded graceful shutdown.

## 3. Packaging and Documentation

- [x] 3.1 Add a pinned multi-stage Dockerfile, non-root runtime, and `.dockerignore`.
- [x] 3.2 Document HTTP deployment and Codex/VS Code remote configuration.

## 4. Verification

- [x] 4.1 Add unit tests for config, auth, and request rejection.
- [x] 4.2 Add an SDK-client transport test covering initialize and discovery.
- [x] 4.3 Run `npm run qc` and verify STDIO initialization remains compatible.
