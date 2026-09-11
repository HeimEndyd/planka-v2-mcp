import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadAttachment, loadedAttachmentToResource } from "../common/attachment-loader.js";
import { buildAttachmentResourceUri } from "../operations/attachments.js";

export const readAttachmentSchema = z.object({
  cardId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe("The ID of the card containing the attachment"),
  attachmentId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe("The ID of the file attachment to read"),
});

export type ReadAttachmentParams = z.infer<typeof readAttachmentSchema>;

export async function readAttachment(params: ReadAttachmentParams): Promise<CallToolResult> {
  const { cardId, attachmentId } = readAttachmentSchema.parse(params);
  const uri = buildAttachmentResourceUri(cardId, attachmentId);
  const loaded = await loadAttachment(cardId, attachmentId);
  const resource = loadedAttachmentToResource(loaded, uri);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          id: loaded.metadata.id,
          cardId: loaded.metadata.cardId,
          name: loaded.metadata.name,
          mimeType: loaded.mimeType,
          size: loaded.bytes.byteLength,
          sha256: loaded.sha256,
          resourceUri: uri,
        }),
      },
      { type: "resource", resource },
    ],
  };
}

export function registerAttachmentTool(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema: Record<string, z.ZodTypeAny>;
      annotations?: ToolAnnotations;
    },
    cb: (args: any) => Promise<CallToolResult>,
  ) => unknown;

  registerTool(
    "mcp_kanban_attachment_manager",
    {
      title: "Planka Attachment Manager",
      description: "Read file attachments from accessible Planka cards without modifying them",
      inputSchema: {
        action: z.literal("read").describe("Read the attachment content"),
        cardId: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .describe("The ID of the card containing the attachment"),
        attachmentId: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .describe("The ID of the file attachment to read"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardId, attachmentId }) => readAttachment({ cardId, attachmentId }),
  );
}
