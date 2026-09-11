import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadIdentityRegistry } from "../common/identity-registry.js";
import {
  type HttpTransportConfig,
  type RunningHttpServer,
  startHttpServer,
} from "../transports/http.js";

const TOKEN_A = "http-identity-a-client-token-with-at-least-32-bytes";
const TOKEN_B = "http-identity-b-client-token-with-at-least-32-bytes";
let tempDirectory: string;
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

function writeSecret(name: string, value: string): string {
  const path = join(tempDirectory, name);
  writeFileSync(path, value, { mode: 0o600 });
  return path;
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

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "planka-http-identities-"));
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await runningMcp?.close();
  await close(fakePlanka);
  runningMcp = undefined;
  fakePlanka = undefined;
  rmSync(tempDirectory, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe("multi-account HTTP transport", () => {
  test("binds two simultaneous MCP clients to different Planka accounts", async () => {
    const observedKeys: string[] = [];
    fakePlanka = createServer((request, response) => {
      const userId = request.url?.split("/").pop();
      const apiKey = request.headers["x-api-key"];
      observedKeys.push(String(apiKey));
      const expectedKey = userId === "user-a" ? "planka-key-a" : "planka-key-b";
      if (apiKey !== expectedKey) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Forbidden" }));
        return;
      }
      setImmediate(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
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

    const descriptorPath = join(tempDirectory, "identities.json");
    writeFileSync(
      descriptorPath,
      JSON.stringify({
        version: 1,
        identities: [
          {
            id: "account-a",
            plankaUserId: "user-a",
            mcpBearerTokenFile: writeSecret("bearer-a", TOKEN_A),
            plankaApiKeyFile: writeSecret("api-key-a", "planka-key-a"),
          },
          {
            id: "account-b",
            plankaUserId: "user-b",
            mcpBearerTokenFile: writeSecret("bearer-b", TOKEN_B),
            plankaApiKeyFile: writeSecret("api-key-b", "planka-key-b"),
          },
        ],
      }),
      { mode: 0o600 },
    );

    const identityRegistry = loadIdentityRegistry(descriptorPath, {
      PLANKA_BASE_URL: `http://127.0.0.1:${plankaAddress.port}`,
    });
    const config: HttpTransportConfig = {
      host: "127.0.0.1",
      port: 0,
      identityRegistry,
      allowedHosts: new Set(["127.0.0.1"]),
      allowedOrigins: new Set(),
      maxBodyBytes: 65536,
      shutdownGraceMs: 1000,
    };
    runningMcp = await startHttpServer(config);

    const clientFor = (token: string) => {
      const client = new Client({ name: "multi-account-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(runningMcp?.endpoint as URL, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      return { client, transport };
    };
    const accountA = clientFor(TOKEN_A);
    const accountB = clientFor(TOKEN_B);

    try {
      await Promise.all([
        accountA.client.connect(accountA.transport as Parameters<Client["connect"]>[0]),
        accountB.client.connect(accountB.transport as Parameters<Client["connect"]>[0]),
      ]);
      const [whoamiA, whoamiB] = await Promise.all([
        accountA.client.callTool({ name: "mcp_kanban_whoami", arguments: {} }),
        accountB.client.callTool({ name: "mcp_kanban_whoami", arguments: {} }),
      ]);

      expect(parseToolText(whoamiA)).toEqual({
        identityId: "account-a",
        plankaUserId: "user-a",
        authMode: "api-key",
        account: { id: "user-a", name: "Account A", username: "user-a", isAdmin: true },
      });
      expect(parseToolText(whoamiB)).toEqual({
        identityId: "account-b",
        plankaUserId: "user-b",
        authMode: "api-key",
        account: { id: "user-b", name: "Account B", username: "user-b", isAdmin: false },
      });
      expect(observedKeys).toEqual(expect.arrayContaining(["planka-key-a", "planka-key-b"]));
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("planka-key-a"));
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("planka-key-b"));
    } finally {
      await Promise.all([accountA.client.close(), accountB.client.close()]);
    }
  });
});
