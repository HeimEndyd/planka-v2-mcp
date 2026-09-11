import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAttachment, loadedAttachmentToResource } from "../common/attachment-loader.js";

export function registerAttachmentResources(server: McpServer): void {
  server.registerResource(
    "planka-attachment",
    new ResourceTemplate("planka-attachment://{cardId}/{attachmentId}", { list: undefined }),
    {
      title: "Planka card attachment",
      description: "Read-only content of a file attachment on an accessible Planka card",
    },
    async (uri, variables) => {
      const cardId = String(variables.cardId);
      const attachmentId = String(variables.attachmentId);
      const loaded = await loadAttachment(cardId, attachmentId);
      return { contents: [loadedAttachmentToResource(loaded, uri.href)] };
    },
  );
}
