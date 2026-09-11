import { AsyncLocalStorage } from "node:async_hooks";
import { getUserAgent } from "universal-user-agent";
import { createPlankaError } from "./errors.js";
import { readEnvironmentSecret } from "./secrets.js";
import { VERSION } from "./version.js";

export type PlankaAuth =
  | { type: "api-key"; apiKey: string }
  | { type: "password"; email: string; password: string };

export type PlankaAuthTarget = "api" | "download";

export type PlankaRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
};

export type PlankaClientConfig = {
  baseUrl: string;
  auth?: PlankaAuth;
  ignoreSsl?: boolean;
};

const USER_AGENT = `modelcontextprotocol/servers/planka/v${VERSION} ${getUserAgent()}`;

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) return response.json();
  return response.text();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/api") ? baseUrl.slice(0, -4) : baseUrl;
}

export class PlankaClient {
  readonly authMode: PlankaAuth["type"] | "none";
  private readonly auth: PlankaAuth | undefined;
  private readonly baseUrl: string;
  private readonly ignoreSsl: boolean;
  private agentToken: string | undefined;

  constructor(config: PlankaClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.auth = config.auth;
    this.authMode = config.auth?.type ?? "none";
    this.ignoreSsl = config.ignoreSsl ?? false;
  }

  private async authenticateAgent(): Promise<string> {
    if (this.auth?.type !== "password") {
      throw new Error("Planka password credentials are not configured");
    }

    const url = new URL("/api/access-tokens", this.baseUrl).toString();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          emailOrUsername: this.auth.email,
          password: this.auth.password,
        }),
        credentials: "include",
      });
      const responseBody = await parseResponseBody(response);
      if (!response.ok) throw createPlankaError(response.status, responseBody);

      const { item } = responseBody as { item: string };
      this.agentToken = item;
      return item;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to authenticate agent with Planka: ${message}`);
    }
  }

  private async getAgentToken(): Promise<string> {
    return this.agentToken ?? this.authenticateAgent();
  }

  async getAuthHeaders(target: PlankaAuthTarget = "api"): Promise<Record<string, string>> {
    if (this.auth?.type === "api-key") return { "X-Api-Key": this.auth.apiKey };
    if (this.auth?.type !== "password") throw new Error("Planka credentials are not configured");

    const token = await this.getAgentToken();
    return target === "download"
      ? { Cookie: `accessToken=${token}` }
      : { Authorization: `Bearer ${token}` };
  }

  async request(path: string, options: PlankaRequestOptions = {}): Promise<unknown> {
    const normalizedPath = path.startsWith("/api/") ? path : `/api/${path}`;
    const urlObject = new URL(normalizedPath, this.baseUrl);
    if (urlObject.host !== new URL(this.baseUrl).host) {
      throw new Error(
        `Security violation: Target host ${urlObject.host} does not match configured Planka host`,
      );
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      ...options.headers,
    };
    if (options.body instanceof FormData) delete headers["Content-Type"];

    if (!options.skipAuth) {
      try {
        Object.assign(headers, await this.getAuthHeaders("api"));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get authentication token: ${message}`);
      }
    }

    if (this.ignoreSsl) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    try {
      const response = await fetch(urlObject.toString(), {
        method: options.method || "GET",
        headers,
        body:
          options.body instanceof FormData
            ? options.body
            : options.body
              ? JSON.stringify(options.body)
              : null,
        credentials: "include",
      });
      const responseBody = await parseResponseBody(response);
      if (!response.ok) throw createPlankaError(response.status, responseBody);
      return responseBody;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to make Planka request: ${message}`);
    }
  }
}

export function createLegacyPlankaClient(
  environment: NodeJS.ProcessEnv = process.env,
): PlankaClient {
  const apiKey = readEnvironmentSecret("PLANKA_API_KEY", environment);
  let auth: PlankaAuth | undefined;
  if (apiKey) {
    auth = { type: "api-key", apiKey };
  } else {
    const email = readEnvironmentSecret("PLANKA_AGENT_EMAIL", environment);
    const password = readEnvironmentSecret("PLANKA_AGENT_PASSWORD", environment, true);
    if (email || password) {
      if (!email || !password) {
        throw new Error("PLANKA_AGENT_EMAIL and PLANKA_AGENT_PASSWORD must both be configured");
      }
      auth = { type: "password", email, password };
    }
  }

  const config: PlankaClientConfig = {
    baseUrl: environment.PLANKA_BASE_URL || "http://localhost:3000",
  };
  if (auth) config.auth = auth;
  if (environment.PLANKA_IGNORE_SSL === "true") config.ignoreSsl = true;
  return new PlankaClient(config);
}

const clientStorage = new AsyncLocalStorage<PlankaClient>();
let legacyClient: PlankaClient | undefined;

export function runWithPlankaClient<T>(client: PlankaClient, callback: () => T): T {
  return clientStorage.run(client, callback);
}

export function getActivePlankaClient(): PlankaClient {
  const active = clientStorage.getStore();
  if (active) return active;
  legacyClient ??= createLegacyPlankaClient();
  return legacyClient;
}
