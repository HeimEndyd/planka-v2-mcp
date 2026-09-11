import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PlankaApiKeyAuthenticator } from "../common/http-authentication.js";
import {
  type HttpTransportConfig,
  type RunningHttpServer,
  startHttpServer,
} from "../transports/http.js";

const API_KEY_A = "planka-api-key-a";
const API_KEY_B = "planka-api-key-b";
let fakePlanka: Server | undefined;
let runningMcp: RunningHttpServer | undefined;

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: Server | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function parseToolText(result: unknown): unknown {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) throw new Error("Expected tool content");
  const item = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (item?.type !== "text" || typeof item.text !== "string") {
    throw new Error("Expected text tool result");
  }
  return JSON.parse(item.text);
}

async function startMcpFor(plankaUrl: string): Promise<RunningHttpServer> {
  const config: HttpTransportConfig = {
    host: "127.0.0.1",
    port: 0,
    authMode: "passthrough",
    authenticator: new PlankaApiKeyAuthenticator(plankaUrl),
    allowedHosts: new Set(["127.0.0.1"]),
    allowedOrigins: new Set(),
    maxBodyBytes: 65536,
    shutdownGraceMs: 1000,
  };
  return startHttpServer(config);
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await runningMcp?.close();
  await close(fakePlanka);
  runningMcp = undefined;
  fakePlanka = undefined;
  jest.restoreAllMocks();
});

describe("multi-account HTTP transport", () => {
  test("binds two simultaneous MCP clients to different Planka accounts", async () => {
    const observedRequests: Array<{ apiKey: string; path: string }> = [];
    fakePlanka = createServer((request, response) => {
      const apiKey = String(request.headers["x-api-key"]);
      observedRequests.push({ apiKey, path: request.url ?? "" });
      const userId = apiKey === API_KEY_A ? "user-a" : apiKey === API_KEY_B ? "user-b" : null;
      if (!userId) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Unauthorized" }));
        return;
      }
      setImmediate(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        if (request.url === "/api/boards/shared") {
          response.end(
            JSON.stringify({
              included: {
                lists: [{ id: `${userId}-list`, name: `${userId}-private-list` }],
              },
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            item: {
              id: userId,
              name: userId === "user-a" ? "Account A" : "Account B",
              username: userId,
              isAdmin: userId === "user-a",
            },
          }),
        );
      });
    });
    await listen(fakePlanka);
    const plankaAddress = fakePlanka.address() as AddressInfo;

    runningMcp = await startMcpFor(`http://127.0.0.1:${plankaAddress.port}`);

    const clientFor = (token: string) => {
      const client = new Client({ name: "multi-account-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(runningMcp?.endpoint as URL, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      return { client, transport };
    };
    const accountA = clientFor(API_KEY_A);
    const accountB = clientFor(API_KEY_B);

    try {
      await Promise.all([
        accountA.client.connect(accountA.transport as Parameters<Client["connect"]>[0]),
        accountB.client.connect(accountB.transport as Parameters<Client["connect"]>[0]),
      ]);
      const [whoamiA, whoamiB] = await Promise.all([
        accountA.client.callTool({ name: "mcp_kanban_whoami", arguments: {} }),
        accountB.client.callTool({ name: "mcp_kanban_whoami", arguments: {} }),
      ]);
      const [listsA, listsB] = await Promise.all([
        accountA.client.callTool({
          name: "mcp_kanban_list_manager",
          arguments: { action: "get_all", boardId: "shared" },
        }),
        accountB.client.callTool({
          name: "mcp_kanban_list_manager",
          arguments: { action: "get_all", boardId: "shared" },
        }),
      ]);

      expect(parseToolText(whoamiA)).toEqual({
        identityId: "planka-user-user-a",
        plankaUserId: "user-a",
        authMode: "api-key",
        account: { id: "user-a", name: "Account A", username: "user-a", isAdmin: true },
      });
      expect(parseToolText(whoamiB)).toEqual({
        identityId: "planka-user-user-b",
        plankaUserId: "user-b",
        authMode: "api-key",
        account: { id: "user-b", name: "Account B", username: "user-b", isAdmin: false },
      });
      expect(parseToolText(listsA)).toEqual([{ id: "user-a-list", name: "user-a-private-list" }]);
      expect(parseToolText(listsB)).toEqual([{ id: "user-b-list", name: "user-b-private-list" }]);
      expect(observedRequests).toEqual(
        expect.arrayContaining([
          { apiKey: API_KEY_A, path: "/api/users/me" },
          { apiKey: API_KEY_B, path: "/api/users/me" },
          { apiKey: API_KEY_A, path: "/api/boards/shared" },
          { apiKey: API_KEY_B, path: "/api/boards/shared" },
        ]),
      );
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(API_KEY_A));
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(API_KEY_B));
    } finally {
      await Promise.all([accountA.client.close(), accountB.client.close()]);
    }
  });

  test("rejects invalid and revoked API keys before parsing JSON", async () => {
    let activeKey = API_KEY_A;
    const observedKeys: string[] = [];
    fakePlanka = createServer((request, response) => {
      const apiKey = String(request.headers["x-api-key"]);
      observedKeys.push(apiKey);
      if (apiKey !== activeKey) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Unauthorized" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ item: { id: "user-a", username: "account-a" } }));
    });
    await listen(fakePlanka);
    const plankaAddress = fakePlanka.address() as AddressInfo;
    runningMcp = await startMcpFor(`http://127.0.0.1:${plankaAddress.port}`);

    const requestWith = (apiKey?: string) =>
      fetch(runningMcp?.endpoint as URL, {
        method: "POST",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        body: "not-json",
      });

    expect((await requestWith()).status).toBe(401);
    expect(observedKeys).toEqual([]);
    expect((await requestWith(API_KEY_A)).status).toBe(400);
    activeKey = API_KEY_B;
    expect((await requestWith(API_KEY_A)).status).toBe(401);
    expect((await requestWith(API_KEY_B)).status).toBe(400);
    expect(observedKeys).toEqual([API_KEY_A, API_KEY_A, API_KEY_B]);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(API_KEY_A));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(API_KEY_B));
  });

  test("returns 503 when Planka cannot validate the API key", async () => {
    fakePlanka = createServer((_request, response) => response.end());
    await listen(fakePlanka);
    const plankaAddress = fakePlanka.address() as AddressInfo;
    await close(fakePlanka);
    fakePlanka = undefined;
    runningMcp = await startMcpFor(`http://127.0.0.1:${plankaAddress.port}`);

    const response = await fetch(runningMcp.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY_A}`,
        "Content-Type": "application/json",
      },
      body: "not-json",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "authentication_unavailable" });
  });
});
