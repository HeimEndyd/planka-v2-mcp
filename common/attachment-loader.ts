import { createHash } from "node:crypto";
import type {
  BlobResourceContents,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { getAttachment, toAttachmentMetadata } from "../operations/attachments.js";
import { getPlankaAuthHeaders } from "./utils.js";

const KIB = 1024;
const MIB = 1024 * KIB;

const MIME_LIMITS = new Map<string, number>([
  ["text/plain", 256 * KIB],
  ["text/markdown", 256 * KIB],
  ["application/json", 256 * KIB],
  ["image/png", 5 * MIB],
  ["image/jpeg", 5 * MIB],
  ["image/webp", 5 * MIB],
  ["image/gif", 5 * MIB],
  ["application/pdf", 10 * MIB],
]);

const GENERIC_BINARY_MIME = "application/octet-stream";
const DEFAULT_TIMEOUT_MS = 30_000;

export type LoadedAttachment = {
  bytes: Uint8Array;
  metadata: ReturnType<typeof toAttachmentMetadata>;
  mimeType: string;
  sha256: string;
};

function normalizedMimeType(value: string | null | undefined): string | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("PLANKA_ATTACHMENT_TIMEOUT_MS must be a positive integer");
  }
  return parsed;
}

function getAllowedForeignOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const value of process.env.PLANKA_ATTACHMENT_ALLOWED_ORIGINS?.split(",") ?? []) {
    const candidate = value.trim();
    if (!candidate) continue;
    const parsed = new URL(candidate);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("PLANKA_ATTACHMENT_ALLOWED_ORIGINS entries must contain origins only");
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function validateDownloadUrl(
  urlValue: string,
  attachmentId: string,
): {
  url: URL;
  sendPlankaCredentials: boolean;
} {
  const url = new URL(urlValue);
  const baseUrl = new URL(process.env.PLANKA_BASE_URL || "http://localhost:3000");
  if (url.username || url.password) {
    throw new Error("Attachment URL must not contain credentials");
  }

  if (url.origin === baseUrl.origin) {
    const basePath = baseUrl.pathname.replace(/\/(?:api)?\/?$/, "").replace(/\/$/, "");
    const prefix = `${basePath}/attachments/${encodeURIComponent(attachmentId)}/download/`;
    if (!url.pathname.startsWith(prefix)) {
      throw new Error("Attachment URL does not match the expected Planka download path");
    }
    return { url, sendPlankaCredentials: true };
  }

  if (!getAllowedForeignOrigins().has(url.origin)) {
    throw new Error("Attachment URL origin is not allowed");
  }
  if (url.protocol !== "https:") {
    throw new Error("Foreign attachment origins must use HTTPS");
  }
  return { url, sendPlankaCredentials: false };
}

async function readResponseWithLimit(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error("Attachment response has an invalid Content-Length");
    }
    if (parsedLength > limit) {
      throw new Error(`Attachment exceeds the ${limit}-byte MIME limit`);
    }
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(`Attachment exceeds the ${limit}-byte MIME limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function loadAttachment(
  cardId: string,
  attachmentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<LoadedAttachment> {
  const attachment = await getAttachment(cardId, attachmentId);
  if (attachment.type !== "file") {
    throw new Error("Link attachments cannot be downloaded by the MCP server");
  }

  const metadata = toAttachmentMetadata(attachment);
  const metadataMimeType = normalizedMimeType(metadata.mimeType);
  const limit = metadataMimeType ? MIME_LIMITS.get(metadataMimeType) : undefined;
  if (!metadataMimeType || limit === undefined) {
    throw new Error(`Unsupported attachment MIME type: ${metadata.mimeType || "unknown"}`);
  }
  if (metadata.size !== null && metadata.size > limit) {
    throw new Error(`Attachment exceeds the ${limit}-byte MIME limit`);
  }

  const { url, sendPlankaCredentials } = validateDownloadUrl(metadata.url, attachmentId);
  const controller = new AbortController();
  const timeoutMs = parsePositiveInteger(
    process.env.PLANKA_ATTACHMENT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const authHeaders = sendPlankaCredentials ? await getPlankaAuthHeaders("download") : {};
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: metadataMimeType,
        ...authHeaders,
      },
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error("Attachment download redirects are not allowed");
    }
    if (!response.ok) {
      throw new Error(`Attachment download failed with HTTP ${response.status}`);
    }

    const responseMimeType = normalizedMimeType(response.headers.get("content-type"));
    if (
      responseMimeType &&
      responseMimeType !== GENERIC_BINARY_MIME &&
      responseMimeType !== metadataMimeType
    ) {
      throw new Error(
        `Attachment MIME mismatch: expected ${metadataMimeType}, received ${responseMimeType}`,
      );
    }

    const bytes = await readResponseWithLimit(response, limit);
    return {
      bytes,
      metadata,
      mimeType: metadataMimeType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Attachment download timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function loadedAttachmentToResource(
  loaded: LoadedAttachment,
  uri: string,
): TextResourceContents | BlobResourceContents {
  if (loaded.mimeType.startsWith("text/") || loaded.mimeType === "application/json") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes);
    } catch {
      throw new Error("Text attachment is not valid UTF-8");
    }
    return { uri, mimeType: loaded.mimeType, text };
  }

  return {
    uri,
    mimeType: loaded.mimeType,
    blob: Buffer.from(loaded.bytes).toString("base64"),
  };
}
