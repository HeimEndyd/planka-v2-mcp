import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createPlankaApiKeyAuthenticator,
  type HttpAuthenticator,
  type McpIdentity,
} from "../common/http-authentication.js";
import { createLegacyIdentityRegistry, loadIdentityRegistry } from "../common/identity-registry.js";
import { readEnvironmentSecret } from "../common/secrets.js";
import { VERSION } from "../common/version.js";
import { createPlankaMcpServer } from "../server.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

export type HttpTransportConfig = {
  host: string;
  port: number;
  authMode: "passthrough" | "managed";
  authenticator: HttpAuthenticator;
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
  maxBodyBytes: number;
  shutdownGraceMs: number;
};

export type RunningHttpServer = {
  server: Server;
  endpoint: URL;
  close: () => Promise<void>;
};

type ServerFactory = (identity: McpIdentity) => McpServer;

const LEGACY_IDENTITY_VARIABLES = [
  "MCP_HTTP_BEARER_TOKEN",
  "MCP_HTTP_BEARER_TOKEN_FILE",
  "PLANKA_API_KEY",
  "PLANKA_API_KEY_FILE",
  "PLANKA_AGENT_EMAIL",
  "PLANKA_AGENT_EMAIL_FILE",
  "PLANKA_AGENT_PASSWORD",
  "PLANKA_AGENT_PASSWORD_FILE",
] as const;

const PASSTHROUGH_CONFLICT_VARIABLES = [
  "MCP_HTTP_IDENTITIES_FILE",
  ...LEGACY_IDENTITY_VARIABLES,
  "PLANKA_USER_ID",
] as const;

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parsePositiveInteger(
  name: string,
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined) return fallback;
  if (!/^\d+$/.test(rawValue)) throw new Error(`${name} must be a positive integer`);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parsePort(rawValue: string | undefined): number {
  const port = parsePositiveInteger("MCP_HTTP_PORT", rawValue, 3000);
  if (port > 65_535) throw new Error("MCP_HTTP_PORT must be at most 65535");
  return port;
}

function parseCsv(rawValue: string | undefined): string[] {
  return (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeConfiguredHost(host: string): string {
  const value = host.toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1);
  if (value.includes(":"))
    throw new Error(`MCP_HTTP_ALLOWED_HOSTS entry "${host}" includes a port`);
  return value;
}

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`MCP_HTTP_ALLOWED_ORIGINS entry "${origin}" must contain only an origin`);
  }
  return parsed.origin;
}

export function loadHttpTransportConfig(
  environment: NodeJS.ProcessEnv = process.env,
): HttpTransportConfig {
  const host = environment.MCP_HTTP_HOST?.trim() || "127.0.0.1";
  const configuredHosts = parseCsv(environment.MCP_HTTP_ALLOWED_HOSTS);
  const defaultHosts = isLoopbackHost(host) ? ["localhost", "127.0.0.1", "[::1]"] : [];
  const allowedHosts = new Set(
    (configuredHosts.length ? configuredHosts : defaultHosts).map(normalizeConfiguredHost),
  );
  const allowedOrigins = new Set(
    parseCsv(environment.MCP_HTTP_ALLOWED_ORIGINS).map(normalizeOrigin),
  );
  const identitiesFile = environment.MCP_HTTP_IDENTITIES_FILE?.trim();
  const configuredAuthMode = environment.MCP_HTTP_AUTH_MODE?.trim() || undefined;
  if (
    configuredAuthMode !== undefined &&
    configuredAuthMode !== "passthrough" &&
    configuredAuthMode !== "managed"
  ) {
    throw new Error('MCP_HTTP_AUTH_MODE must be "passthrough" or "managed"');
  }
  const hasManagedConfiguration = Boolean(
    identitiesFile || LEGACY_IDENTITY_VARIABLES.some((name) => environment[name]?.trim()),
  );
  const authMode = configuredAuthMode ?? (hasManagedConfiguration ? "managed" : "passthrough");
  let bearerToken: string | undefined;
  let authenticator: HttpAuthenticator;

  if (authMode === "passthrough") {
    const conflictingVariable = PASSTHROUGH_CONFLICT_VARIABLES.find((name) =>
      environment[name]?.trim(),
    );
    if (conflictingVariable) {
      throw new Error(
        `MCP_HTTP_AUTH_MODE=passthrough cannot be combined with ${conflictingVariable}`,
      );
    }
    authenticator = createPlankaApiKeyAuthenticator(environment);
  } else {
    if (identitiesFile) {
      const conflictingVariable = LEGACY_IDENTITY_VARIABLES.find((name) =>
        environment[name]?.trim(),
      );
      if (conflictingVariable) {
        throw new Error(
          `MCP_HTTP_IDENTITIES_FILE cannot be combined with legacy ${conflictingVariable}`,
        );
      }
      authenticator = loadIdentityRegistry(identitiesFile, environment);
    } else {
      bearerToken = readEnvironmentSecret("MCP_HTTP_BEARER_TOKEN", environment);
      authenticator = createLegacyIdentityRegistry(bearerToken, environment);
    }
  }

  if (!isLoopbackHost(host) && !authenticator.requiresBearer) {
    throw new Error("MCP bearer authentication is required for non-loopback HTTP bind");
  }
  if (bearerToken && Buffer.byteLength(bearerToken, "utf8") < 32) {
    throw new Error("MCP_HTTP_BEARER_TOKEN must contain at least 32 bytes");
  }
  if (allowedHosts.size === 0) {
    throw new Error("MCP_HTTP_ALLOWED_HOSTS is required for non-loopback HTTP bind");
  }

  return {
    host,
    port: parsePort(environment.MCP_HTTP_PORT),
    authMode,
    authenticator,
    allowedHosts,
    allowedOrigins,
    maxBodyBytes: parsePositiveInteger(
      "MCP_HTTP_MAX_BODY_BYTES",
      environment.MCP_HTTP_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
    ),
    shutdownGraceMs: parsePositiveInteger(
      "MCP_HTTP_SHUTDOWN_GRACE_MS",
      environment.MCP_HTTP_SHUTDOWN_GRACE_MS,
      DEFAULT_SHUTDOWN_GRACE_MS,
    ),
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function requestPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? "", "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

function requestHostname(request: IncomingMessage): string | undefined {
  const host = request.headers.host;
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isAllowedOrigin(request: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) throw new Error("invalid-content-length");
    if (Number(contentLength) > maxBytes) throw new Error("body-too-large");
  }

  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("body-too-large");
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("malformed-json");
  }
}

function auditRequest(body: unknown): { method: string; tool?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { method: "unknown" };
  const request = body as { method?: unknown; params?: { name?: unknown } };
  const method = typeof request.method === "string" ? request.method : "unknown";
  const tool =
    method === "tools/call" && typeof request.params?.name === "string"
      ? request.params.name
      : undefined;
  return tool ? { method, tool } : { method };
}

function writeAudit(
  identity: McpIdentity,
  body: unknown,
  status: "ok" | "error",
  startedAt: number,
): void {
  console.error(
    JSON.stringify({
      event: "mcp_request",
      identityId: identity.id,
      ...auditRequest(body),
      status,
      durationMs: Date.now() - startedAt,
    }),
  );
}

export function createHttpRequestHandler(
  config: HttpTransportConfig,
  activeServers: Set<McpServer>,
  serverFactory: ServerFactory = (identity) => createPlankaMcpServer(identity),
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const path = requestPath(request);

    if (path === "/healthz") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        writeJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      writeJson(response, 200, { status: "ok", version: VERSION });
      return;
    }

    if (path !== "/mcp") {
      writeJson(response, 404, { error: "not_found" });
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      writeJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    let identity: McpIdentity | undefined;
    try {
      identity = await config.authenticator.authenticate(request.headers.authorization);
    } catch {
      writeJson(response, 503, { error: "authentication_unavailable" });
      return;
    }
    if (!identity) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="planka-mcp"');
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const hostname = requestHostname(request);
    if (!hostname || !config.allowedHosts.has(hostname)) {
      writeJson(response, 421, { error: "host_not_allowed" });
      return;
    }

    if (!isAllowedOrigin(request, config.allowedOrigins)) {
      writeJson(response, 403, { error: "origin_not_allowed" });
      return;
    }

    const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      writeJson(response, 415, { error: "unsupported_media_type" });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(request, config.maxBodyBytes);
    } catch (error: unknown) {
      request.resume();
      if (error instanceof Error && error.message === "body-too-large") {
        writeJson(response, 413, { error: "body_too_large" });
      } else {
        writeJson(response, 400, { error: "malformed_json" });
      }
      return;
    }

    // The SDK documents explicit undefined as stateless mode, but its declaration conflicts with
    // TypeScript's exactOptionalPropertyTypes setting.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined as unknown as () => string,
    });
    const mcpServer = serverFactory(identity);
    const startedAt = Date.now();
    let auditStatus: "ok" | "error" = "ok";
    activeServers.add(mcpServer);
    try {
      await mcpServer.connect(transport as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(request, response, body);
    } catch {
      auditStatus = "error";
      writeJson(response, 500, { error: "internal_server_error" });
    } finally {
      writeAudit(identity, body, auditStatus, startedAt);
      activeServers.delete(mcpServer);
      await mcpServer.close().catch(() => undefined);
    }
  };
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeListener(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}

export async function startHttpServer(
  config: HttpTransportConfig = loadHttpTransportConfig(),
  serverFactory: ServerFactory = (identity) => createPlankaMcpServer(identity),
): Promise<RunningHttpServer> {
  const activeServers = new Set<McpServer>();
  const handler = createHttpRequestHandler(config, activeServers, serverFactory);
  const httpServer = createServer((request, response) => {
    handler(request, response).catch(() => {
      writeJson(response, 500, { error: "internal_server_error" });
    });
  });
  await listen(httpServer, config.port, config.host);

  const address = httpServer.address() as AddressInfo;
  const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  const endpoint = new URL(`http://${displayHost}:${address.port}/mcp`);
  let closing: Promise<void> | undefined;

  const shutdown = () => {
    close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      const timeout = setTimeout(() => httpServer.closeAllConnections?.(), config.shutdownGraceMs);
      timeout.unref();
      try {
        await Promise.all([
          closeListener(httpServer),
          ...Array.from(activeServers, (server) => server.close().catch(() => undefined)),
        ]);
      } finally {
        clearTimeout(timeout);
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
      }
    })();
    return closing;
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.error(
    `Planka MCP Streamable HTTP listening at ${endpoint.toString()} (auth: ${config.authMode})`,
  );
  return { server: httpServer, endpoint, close };
}
