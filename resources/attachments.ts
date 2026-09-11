import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAttachment, loadedAttachmentToResource } from "../common/attachment-loader.js";

export type IdentityRunner = <T>(callback: () => Promise<T>) => Promise<T>;

export function registerAttachmentResources(
  server: McpServer,
  runAsIdentity: IdentityRunner = (callback) => callback(),
): void {
  server.registerResource(
    "planka-attachment",
    new ResourceTemplate("planka-attachment://{cardId}/{attachmentId}", { list: undefined }),
    {
      title: "Planka card attachment",
      description: "Read-only content of a file attachment on an accessible Planka card",
    },
    async (uri, variables) =>
      runAsIdentity(async () => {
        const cardId = String(variables.cardId);
        const attachmentId = String(variables.attachmentId);
        const loaded = await loadAttachment(cardId, attachmentId);
        return { contents: [loadedAttachmentToResource(loaded, uri.href)] };
      }),
  );
}
