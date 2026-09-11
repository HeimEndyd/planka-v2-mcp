import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { loadIdentityRegistry } from "../common/identity-registry.js";
import { PlankaClient, runWithPlankaClient } from "../common/planka-client.js";
import { getPlankaAuthHeaders, plankaRequest } from "../common/utils.js";

const TOKEN_A = "identity-a-client-token-with-at-least-32-bytes";
const TOKEN_B = "identity-b-client-token-with-at-least-32-bytes";
let tempDirectory: string;
let originalFetch: typeof fetch;

function secret(name: string, value: string): string {
  const path = join(tempDirectory, name);
  writeFileSync(path, value, { mode: 0o600 });
  return path;
}

function descriptor(identities: unknown[]): string {
  const path = join(tempDirectory, "identities.json");
  writeFileSync(path, JSON.stringify({ version: 1, identities }), { mode: 0o600 });
  return path;
}

function apiKeyIdentity(id: string, token: string, apiKey: string) {
  return {
    id,
    plankaUserId: `${id}-user`,
    mcpBearerTokenFile: secret(`${id}-bearer`, token),
    plankaApiKeyFile: secret(`${id}-api-key`, apiKey),
  };
}

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "planka-identities-"));
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  rmSync(tempDirectory, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe("MCP identity registry", () => {
  test("maps independent bearer tokens to independent Planka clients", () => {
    const registry = loadIdentityRegistry(
      descriptor([
        apiKeyIdentity("owner", TOKEN_A, "planka-key-a"),
        apiKeyIdentity("reader", TOKEN_B, "planka-key-b"),
      ]),
      { PLANKA_BASE_URL: "https://planka.example" },
    );

    expect(registry.requiresBearer).toBe(true);
    expect(registry.size).toBe(2);
    expect(registry.authenticate(`Bearer ${TOKEN_A}`)?.id).toBe("owner");
    expect(registry.authenticate(`Bearer ${TOKEN_B}`)?.id).toBe("reader");
    expect(registry.authenticate("Bearer unknown-token-with-at-least-32-bytes")).toBeUndefined();
    expect(registry.authenticate(undefined)).toBeUndefined();
  });

  test("keeps concurrent request and attachment authentication isolated", async () => {
    const registry = loadIdentityRegistry(
      descriptor([
        apiKeyIdentity("owner", TOKEN_A, "planka-key-a"),
        apiKeyIdentity("reader", TOKEN_B, "planka-key-b"),
      ]),
      { PLANKA_BASE_URL: "https://planka.example" },
    );
    const owner = registry.authenticate(`Bearer ${TOKEN_A}`);
    const reader = registry.authenticate(`Bearer ${TOKEN_B}`);
    if (!owner || !reader) throw new Error("test identities were not loaded");

    global.fetch = jest.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      await new Promise((resolve) => setImmediate(resolve));
      const headers = options?.headers as Record<string, string>;
      return new Response(JSON.stringify({ item: headers["X-Api-Key"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const [ownerResponse, readerResponse, ownerDownload, readerDownload] = await Promise.all([
      runWithPlankaClient(owner.plankaClient, () => plankaRequest("/api/identity")),
      runWithPlankaClient(reader.plankaClient, () => plankaRequest("/api/identity")),
      runWithPlankaClient(owner.plankaClient, () => getPlankaAuthHeaders("download")),
      runWithPlankaClient(reader.plankaClient, () => getPlankaAuthHeaders("download")),
    ]);

    expect(ownerResponse).toEqual({ item: "planka-key-a" });
    expect(readerResponse).toEqual({ item: "planka-key-b" });
    expect(ownerDownload).toEqual({ "X-Api-Key": "planka-key-a" });
    expect(readerDownload).toEqual({ "X-Api-Key": "planka-key-b" });
  });

  test("keeps password access-token caches isolated by client", async () => {
    const clientA = new PlankaClient({
      baseUrl: "https://planka.example",
      auth: { type: "password", email: "a@example.test", password: "password-a" },
    });
    const clientB = new PlankaClient({
      baseUrl: "https://planka.example",
      auth: { type: "password", email: "b@example.test", password: "password-b" },
    });
    const logins: string[] = [];
    const requestTokens: string[] = [];
    global.fetch = jest.fn<typeof fetch>().mockImplementation(async (url, options) => {
      await new Promise((resolve) => setImmediate(resolve));
      if (String(url).endsWith("/api/access-tokens")) {
        const body = JSON.parse(String(options?.body)) as { emailOrUsername: string };
        logins.push(body.emailOrUsername);
        return new Response(
          JSON.stringify({ item: body.emailOrUsername.startsWith("a") ? "token-a" : "token-b" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const headers = options?.headers as Record<string, string>;
      const authorization = String(headers.Authorization);
      requestTokens.push(authorization);
      return new Response(JSON.stringify({ item: authorization }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const [firstA, firstB] = await Promise.all([
      runWithPlankaClient(clientA, () => plankaRequest("/api/identity")),
      runWithPlankaClient(clientB, () => plankaRequest("/api/identity")),
    ]);
    const [secondA, secondB] = await Promise.all([
      runWithPlankaClient(clientA, () => plankaRequest("/api/identity")),
      runWithPlankaClient(clientB, () => plankaRequest("/api/identity")),
    ]);

    expect(firstA).toEqual({ item: "Bearer token-a" });
    expect(firstB).toEqual({ item: "Bearer token-b" });
    expect(secondA).toEqual({ item: "Bearer token-a" });
    expect(secondB).toEqual({ item: "Bearer token-b" });
    expect(logins.sort()).toEqual(["a@example.test", "b@example.test"]);
    expect(requestTokens.sort()).toEqual(
      ["Bearer token-a", "Bearer token-b", "Bearer token-a", "Bearer token-b"].sort(),
    );
  });

  test("rejects duplicate ids, duplicate bearer tokens, and short bearer tokens", () => {
    expect(() =>
      loadIdentityRegistry(
        descriptor([
          apiKeyIdentity("same", TOKEN_A, "key-a"),
          apiKeyIdentity("same", TOKEN_B, "key-b"),
        ]),
      ),
    ).toThrow("Duplicate MCP identity id");

    expect(() =>
      loadIdentityRegistry(
        descriptor([
          apiKeyIdentity("first", TOKEN_A, "key-a"),
          apiKeyIdentity("second", TOKEN_A, "key-b"),
        ]),
      ),
    ).toThrow("MCP bearer tokens must be unique");

    expect(() =>
      loadIdentityRegistry(descriptor([apiKeyIdentity("short", "too-short", "key")])),
    ).toThrow("must contain 32 bytes");

    expect(() =>
      loadIdentityRegistry(descriptor([apiKeyIdentity("reused", TOKEN_A, TOKEN_A)])),
    ).toThrow("must not reuse a Planka credential");
  });

  test("rejects mixed upstream auth modes and relative secret paths", () => {
    const mixed = {
      ...apiKeyIdentity("mixed", TOKEN_A, "key"),
      plankaEmailFile: secret("mixed-email", "agent@example.test"),
      plankaPasswordFile: secret("mixed-password", "password"),
    };
    expect(() => loadIdentityRegistry(descriptor([mixed]))).toThrow(
      "Invalid MCP_HTTP_IDENTITIES_FILE",
    );

    const relative = {
      id: "relative",
      plankaUserId: "user-id",
      mcpBearerTokenFile: "relative-token",
      plankaApiKeyFile: secret("relative-key", "key"),
    };
    expect(() => loadIdentityRegistry(descriptor([relative]))).toThrow(
      "secret paths must be absolute",
    );
  });
});
