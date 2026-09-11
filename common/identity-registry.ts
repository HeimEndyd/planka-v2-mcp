import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { createLegacyPlankaClient, type PlankaAuth, PlankaClient } from "./planka-client.js";
import { readSecretFile } from "./secrets.js";

const secretPathSchema = z.string().min(1).refine(isAbsolute, "secret paths must be absolute");
const identityIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "invalid identity id");

const identityBaseSchema = z.object({
  id: identityIdSchema,
  plankaUserId: z.string().regex(/^[A-Za-z0-9_-]+$/, "invalid Planka user id"),
  mcpBearerTokenFile: secretPathSchema,
});

const apiKeyIdentitySchema = identityBaseSchema
  .extend({
    plankaApiKeyFile: secretPathSchema,
  })
  .strict();

const passwordIdentitySchema = identityBaseSchema
  .extend({
    plankaEmailFile: secretPathSchema,
    plankaPasswordFile: secretPathSchema,
  })
  .strict();

const descriptorSchema = z
  .object({
    version: z.literal(1),
    identities: z.array(z.union([apiKeyIdentitySchema, passwordIdentitySchema])).min(1),
  })
  .strict();

type DescriptorIdentity = z.infer<typeof descriptorSchema>["identities"][number];

export type McpIdentity = {
  id: string;
  plankaUserId: string | undefined;
  plankaClient: PlankaClient;
};

type AuthenticatedIdentity = {
  identity: McpIdentity;
  bearerDigest: Buffer;
};

function digestBearer(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  return /^Bearer\s+([^\s]+)$/i.exec(header)?.[1];
}

export class IdentityRegistry {
  readonly requiresBearer: boolean;
  readonly size: number;
  private readonly identities: readonly AuthenticatedIdentity[];
  private readonly anonymousIdentity: McpIdentity | undefined;

  constructor(identities: readonly AuthenticatedIdentity[], anonymousIdentity?: McpIdentity) {
    this.identities = identities;
    this.anonymousIdentity = anonymousIdentity;
    this.requiresBearer = anonymousIdentity === undefined;
    this.size = identities.length + (anonymousIdentity ? 1 : 0);
  }

  authenticate(authorizationHeader: string | undefined): McpIdentity | undefined {
    if (this.anonymousIdentity) return this.anonymousIdentity;

    const token = parseBearer(authorizationHeader);
    if (!token) return undefined;
    const suppliedDigest = digestBearer(token);
    let matched: AuthenticatedIdentity | undefined;
    for (const identity of this.identities) {
      if (timingSafeEqual(suppliedDigest, identity.bearerDigest)) matched = identity;
    }
    return matched?.identity;
  }
}

function readDescriptor(path: string): z.infer<typeof descriptorSchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read MCP_HTTP_IDENTITIES_FILE: ${message}`);
  }

  const result = descriptorSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid MCP_HTTP_IDENTITIES_FILE: ${issues}`);
  }
  return result.data;
}

function readIdentityAuth(identity: DescriptorIdentity): PlankaAuth {
  if ("plankaApiKeyFile" in identity) {
    return {
      type: "api-key",
      apiKey: readSecretFile(identity.plankaApiKeyFile, `${identity.id} Planka API key`),
    };
  }
  return {
    type: "password",
    email: readSecretFile(identity.plankaEmailFile, `${identity.id} Planka email`),
    password: readSecretFile(identity.plankaPasswordFile, `${identity.id} Planka password`, true),
  };
}

export function loadIdentityRegistry(
  descriptorPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): IdentityRegistry {
  if (!isAbsolute(descriptorPath)) {
    throw new Error("MCP_HTTP_IDENTITIES_FILE must be an absolute path");
  }

  const descriptor = readDescriptor(descriptorPath);
  const seenIds = new Set<string>();
  const seenDigests = new Set<string>();
  const identities: AuthenticatedIdentity[] = [];

  for (const definition of descriptor.identities) {
    if (seenIds.has(definition.id)) {
      throw new Error(`Duplicate MCP identity id: ${definition.id}`);
    }

    const bearer = readSecretFile(
      definition.mcpBearerTokenFile,
      `${definition.id} MCP bearer token`,
    );
    if (Buffer.byteLength(bearer, "utf8") < 32) {
      throw new Error(`MCP bearer token for identity ${definition.id} must contain 32 bytes`);
    }
    const bearerDigest = digestBearer(bearer);
    const digestHex = bearerDigest.toString("hex");
    if (seenDigests.has(digestHex)) {
      throw new Error("MCP bearer tokens must be unique across identities");
    }

    const auth = readIdentityAuth(definition);
    if (
      bearer === (auth.type === "api-key" ? auth.apiKey : auth.email) ||
      (auth.type === "password" && bearer === auth.password)
    ) {
      throw new Error(
        `MCP bearer must not reuse a Planka credential for identity ${definition.id}`,
      );
    }
    const clientConfig = {
      baseUrl: environment.PLANKA_BASE_URL || "http://localhost:3000",
      auth,
      ...(environment.PLANKA_IGNORE_SSL === "true" ? { ignoreSsl: true } : {}),
    };
    identities.push({
      bearerDigest,
      identity: {
        id: definition.id,
        plankaUserId: definition.plankaUserId,
        plankaClient: new PlankaClient(clientConfig),
      },
    });
    seenIds.add(definition.id);
    seenDigests.add(digestHex);
  }

  return new IdentityRegistry(identities);
}

export function createLegacyIdentityRegistry(
  bearerToken: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): IdentityRegistry {
  const identity: McpIdentity = {
    id: "default",
    plankaUserId: environment.PLANKA_USER_ID?.trim() || undefined,
    plankaClient: createLegacyPlankaClient(environment),
  };
  if (!bearerToken) return new IdentityRegistry([], identity);

  return new IdentityRegistry([{ identity, bearerDigest: digestBearer(bearerToken) }]);
}
