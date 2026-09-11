import { z } from "zod";
import { PlankaClient } from "./planka-client.js";

export type PlankaAccount = {
  id: string;
  name?: string | null;
  username?: string | null;
  isAdmin?: boolean;
};

export type McpIdentity = {
  id: string;
  plankaUserId: string | undefined;
  plankaClient: PlankaClient;
  account?: PlankaAccount;
};

export type HttpAuthenticator = {
  readonly requiresBearer: boolean;
  authenticate(
    authorizationHeader: string | undefined,
  ): McpIdentity | undefined | Promise<McpIdentity | undefined>;
};

const currentUserResponseSchema = z.object({
  item: z.object({
    id: z.string(),
    name: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
    isAdmin: z.boolean().optional(),
  }),
});

export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  return /^Bearer\s+([^\s]+)$/i.exec(header)?.[1];
}

export class PlankaApiKeyAuthenticator implements HttpAuthenticator {
  readonly requiresBearer = true;

  constructor(
    private readonly baseUrl: string,
    private readonly ignoreSsl = false,
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<McpIdentity | undefined> {
    const apiKey = parseBearer(authorizationHeader);
    if (!apiKey) return undefined;

    const plankaClient = new PlankaClient({
      baseUrl: this.baseUrl,
      auth: { type: "api-key", apiKey },
      ignoreSsl: this.ignoreSsl,
    });
    const response = await plankaClient.validateApiKey();
    if (!response) return undefined;

    const { item } = currentUserResponseSchema.parse(response);
    return {
      id: `planka-user-${item.id}`,
      plankaUserId: item.id,
      plankaClient,
      account: {
        id: item.id,
        ...(item.name !== undefined ? { name: item.name } : {}),
        ...(item.username !== undefined ? { username: item.username } : {}),
        ...(item.isAdmin !== undefined ? { isAdmin: item.isAdmin } : {}),
      },
    };
  }
}

export function createPlankaApiKeyAuthenticator(
  environment: NodeJS.ProcessEnv = process.env,
): PlankaApiKeyAuthenticator {
  return new PlankaApiKeyAuthenticator(
    environment.PLANKA_BASE_URL || "http://localhost:3000",
    environment.PLANKA_IGNORE_SSL === "true",
  );
}
