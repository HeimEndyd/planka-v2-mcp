import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { HttpTransportConfig, RunningHttpServer } from "../transports/http.js";
import { loadHttpTransportConfig, startHttpServer } from "../transports/http.js";

const TOKEN = "test-client-bearer-token-with-at-least-32-bytes";
let running: RunningHttpServer | undefined;

function testConfig(overrides: Partial<HttpTransportConfig> = {}): HttpTransportConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    bearerToken: TOKEN,
    allowedHosts: new Set(["127.0.0.1"]),
    allowedOrigins: new Set(),
    maxBodyBytes: 1024,
    shutdownGraceMs: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  jest.restoreAllMocks();
});

describe("HTTP transport configuration", () => {
  test("fails closed on a public bind without a bearer", () => {
    expect(() =>
      loadHttpTransportConfig({
        MCP_HTTP_HOST: "0.0.0.0",
        MCP_HTTP_ALLOWED_HOSTS: "planka.example.com",
      }),
    ).toThrow("required for non-loopback HTTP bind");
  });

  test("requires explicit allowed hosts for a public bind", () => {
    expect(() =>
      loadHttpTransportConfig({
        MCP_HTTP_HOST: "0.0.0.0",
        MCP_HTTP_BEARER_TOKEN: TOKEN,
      }),
    ).toThrow("MCP_HTTP_ALLOWED_HOSTS is required");
  });

  test("loads a valid public configuration", () => {
    const config = loadHttpTransportConfig({
      MCP_HTTP_HOST: "0.0.0.0",
      MCP_HTTP_PORT: "3008",
      MCP_HTTP_BEARER_TOKEN: TOKEN,
      MCP_HTTP_ALLOWED_HOSTS: "planka.example.com",
      MCP_HTTP_ALLOWED_ORIGINS: "https://planka.example.com",
    });

    expect(config.port).toBe(3008);
    expect(config.allowedHosts.has("planka.example.com")).toBe(true);
    expect(config.allowedOrigins.has("https://planka.example.com")).toBe(true);
  });
});

describe("Streamable HTTP server", () => {
  test("serves health without authentication", async () => {
    running = await startHttpServer(testConfig());

    const response = await fetch(new URL("/healthz", running.endpoint));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", version: "1.1.0" });
  });

  test("rejects missing authentication before parsing JSON", async () => {
    running = await startHttpServer(testConfig());

    const response = await fetch(running.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  test("rejects invalid Origin, malformed JSON, and oversized bodies", async () => {
    running = await startHttpServer(testConfig({ maxBodyBytes: 64 }));
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    };

    const originResponse = await fetch(running.endpoint, {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.example" },
      body: "{}",
    });
    expect(originResponse.status).toBe(403);

    const malformedResponse = await fetch(running.endpoint, {
      method: "POST",
      headers,
      body: "not-json",
    });
    expect(malformedResponse.status).toBe(400);

    const oversizedResponse = await fetch(running.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: "x".repeat(100) }),
    });
    expect(oversizedResponse.status).toBe(413);
  });

  test("supports initialize and discovery through the official SDK client", async () => {
    running = await startHttpServer(testConfig({ maxBodyBytes: 64 * 1024 }));
    const transport = new StreamableHTTPClientTransport(running.endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "http-transport-test", version: "1.0.0" });

    try {
      await client.connect(transport as Parameters<Client["connect"]>[0]);
      const tools = await client.listTools();
      const templates = await client.listResourceTemplates();

      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["mcp_kanban_card_manager", "mcp_kanban_attachment_manager"]),
      );
      expect(templates.resourceTemplates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uriTemplate: "planka-attachment://{cardId}/{attachmentId}" }),
        ]),
      );
    } finally {
      await client.close();
    }
  });
});
