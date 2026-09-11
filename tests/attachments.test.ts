import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PlankaAttachmentSchema } from "../common/types.js";
import { fileAttachment } from "./fixtures.js";

type OneArg = (value: string) => Promise<unknown>;

const getCardWithIncluded = jest.fn<OneArg>();

jest.unstable_mockModule("../operations/cards.js", () => ({
  getCardWithIncluded,
}));

const { buildAttachmentResourceUri, getAttachment, toAttachmentMetadata } = await import(
  "../operations/attachments.js"
);
const { loadAttachment, loadedAttachmentToResource } = await import(
  "../common/attachment-loader.js"
);
const { readAttachment, registerAttachmentTool } = await import("../tools/attachment-manager.js");
const { registerAttachmentResources } = await import("../resources/attachments.js");

const originalEnv = process.env;

function cardResponse(attachment: unknown = fileAttachment) {
  return {
    item: {
      id: "card-1",
      listId: "list-1",
      name: "Card",
      type: "project",
      description: null,
      position: 65535,
      dueDate: null,
      createdAt: null,
      updatedAt: null,
    },
    included: { attachments: [attachment] },
  };
}

describe("read-only attachment content", () => {
  beforeEach(() => {
    getCardWithIncluded.mockReset();
    process.env = {
      ...originalEnv,
      PLANKA_BASE_URL: "https://planka.example.test",
      PLANKA_API_KEY: "test-api-key",
    };
    delete process.env.PLANKA_ATTACHMENT_ALLOWED_ORIGINS;
    delete process.env.PLANKA_ATTACHMENT_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  test("builds stable resource URIs and read-only metadata", () => {
    expect(buildAttachmentResourceUri("card-1", "attachment-1")).toBe(
      "planka-attachment://card-1/attachment-1",
    );
    expect(toAttachmentMetadata(PlankaAttachmentSchema.parse(fileAttachment))).toMatchObject({
      id: "attachment-1",
      cardId: "card-1",
      resourceUri: "planka-attachment://card-1/attachment-1",
    });
    expect(() => buildAttachmentResourceUri("../card", "attachment-1")).toThrow(
      "Card ID contains unsupported characters",
    );
  });

  test("requires the attachment to belong to the requested card", async () => {
    getCardWithIncluded.mockResolvedValueOnce(cardResponse());
    await expect(getAttachment("card-1", "missing")).rejects.toThrow(
      "Attachment missing was not found on card card-1",
    );
  });

  test("downloads a PDF with an API key and returns a base64 MCP resource", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nfixture\n");
    getCardWithIncluded.mockResolvedValue(cardResponse());
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": String(bytes.byteLength),
        },
      }),
    );

    const loaded = await loadAttachment("card-1", "attachment-1", fetchMock);
    expect(loaded.bytes).toEqual(bytes);
    expect(loaded.sha256).toHaveLength(64);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(fileAttachment.data.url),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: expect.objectContaining({ "X-Api-Key": "test-api-key" }),
      }),
    );
    expect(loadedAttachmentToResource(loaded, "planka-attachment://card-1/attachment-1")).toEqual({
      uri: "planka-attachment://card-1/attachment-1",
      mimeType: "application/pdf",
      blob: Buffer.from(bytes).toString("base64"),
    });
  });

  test("returns UTF-8 text directly in an MCP resource", async () => {
    const attachment = {
      ...fileAttachment,
      name: "notes.md",
      data: {
        mimeType: "text/markdown",
        size: 7,
        url: "https://planka.example.test/attachments/attachment-1/download/notes.md",
      },
    };
    getCardWithIncluded.mockResolvedValue(cardResponse(attachment));
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("# Notes", { status: 200, headers: { "content-type": "text/markdown" } }),
      );

    const loaded = await loadAttachment("card-1", "attachment-1", fetchMock);
    expect(loadedAttachmentToResource(loaded, "planka-attachment://card-1/attachment-1")).toEqual({
      uri: "planka-attachment://card-1/attachment-1",
      mimeType: "text/markdown",
      text: "# Notes",
    });
  });

  test("rejects link attachments, foreign origins, redirects, and MIME mismatches", async () => {
    const linkAttachment = {
      ...fileAttachment,
      type: "link",
      data: { url: "https://example.org" },
    };
    getCardWithIncluded.mockResolvedValueOnce(cardResponse(linkAttachment));
    await expect(loadAttachment("card-1", "attachment-1", jest.fn<typeof fetch>())).rejects.toThrow(
      "Link attachments cannot be downloaded",
    );

    getCardWithIncluded.mockResolvedValueOnce(
      cardResponse({
        ...fileAttachment,
        data: { ...fileAttachment.data, url: "https://evil.example/file.pdf" },
      }),
    );
    await expect(loadAttachment("card-1", "attachment-1", jest.fn<typeof fetch>())).rejects.toThrow(
      "origin is not allowed",
    );

    getCardWithIncluded.mockResolvedValueOnce(
      cardResponse({
        ...fileAttachment,
        data: {
          ...fileAttachment.data,
          url: "https://planka.example.test/api/users/attachment-1/download/file.pdf",
        },
      }),
    );
    await expect(loadAttachment("card-1", "attachment-1", jest.fn<typeof fetch>())).rejects.toThrow(
      "does not match the expected Planka download path",
    );

    getCardWithIncluded.mockResolvedValueOnce(cardResponse());
    await expect(
      loadAttachment(
        "card-1",
        "attachment-1",
        jest.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302 })),
      ),
    ).rejects.toThrow("redirects are not allowed");

    getCardWithIncluded.mockResolvedValueOnce(cardResponse());
    await expect(
      loadAttachment(
        "card-1",
        "attachment-1",
        jest.fn<typeof fetch>().mockResolvedValue(
          new Response("not a PDF", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        ),
      ),
    ).rejects.toThrow("Attachment MIME mismatch");
  });

  test("downloads from an allowlisted HTTPS origin without sending Planka credentials", async () => {
    process.env.PLANKA_ATTACHMENT_ALLOWED_ORIGINS = "https://objects.example.test";
    const attachment = {
      ...fileAttachment,
      data: {
        ...fileAttachment.data,
        url: "https://objects.example.test/private/plan.pdf?signature=test",
      },
    };
    getCardWithIncluded.mockResolvedValueOnce(cardResponse(attachment));
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response("%PDF-1.4", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    await loadAttachment("card-1", "attachment-1", fetchMock);

    const requestOptions = fetchMock.mock.calls[0]?.[1];
    expect(requestOptions?.headers).toEqual({ Accept: "application/pdf" });
  });

  test("enforces metadata, Content-Length, and streamed byte limits", async () => {
    const oversizedMetadata = {
      ...fileAttachment,
      data: { ...fileAttachment.data, size: 10 * 1024 * 1024 + 1 },
    };
    getCardWithIncluded.mockResolvedValueOnce(cardResponse(oversizedMetadata));
    await expect(loadAttachment("card-1", "attachment-1", jest.fn<typeof fetch>())).rejects.toThrow(
      "exceeds",
    );

    getCardWithIncluded.mockResolvedValueOnce(cardResponse());
    await expect(
      loadAttachment(
        "card-1",
        "attachment-1",
        jest.fn<typeof fetch>().mockResolvedValue(
          new Response(null, {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-length": String(10 * 1024 * 1024 + 1),
            },
          }),
        ),
      ),
    ).rejects.toThrow("exceeds");

    const textAttachment = {
      ...fileAttachment,
      data: {
        mimeType: "text/plain",
        url: "https://planka.example.test/attachments/attachment-1/download/large.txt",
      },
    };
    getCardWithIncluded.mockResolvedValueOnce(cardResponse(textAttachment));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    await expect(
      loadAttachment(
        "card-1",
        "attachment-1",
        jest
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(stream, { status: 200, headers: { "content-type": "text/plain" } }),
          ),
      ),
    ).rejects.toThrow("exceeds");
  });

  test("attachment tool embeds the downloaded resource and integrity metadata", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\ntool fixture\n");
    getCardWithIncluded.mockResolvedValue(cardResponse());
    global.fetch = jest.fn<typeof fetch>().mockImplementation(async () => {
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    });

    const result = await readAttachment({ cardId: "card-1", attachmentId: "attachment-1" });
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.content[1]).toEqual({
      type: "resource",
      resource: {
        uri: "planka-attachment://card-1/attachment-1",
        mimeType: "application/pdf",
        blob: Buffer.from(bytes).toString("base64"),
      },
    });
  });

  test("advertises and reads the attachment tool and resource over MCP", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nmcp fixture\n");
    getCardWithIncluded.mockResolvedValue(cardResponse());
    global.fetch = jest.fn<typeof fetch>().mockImplementation(async () => {
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    });

    const server = new McpServer({ name: "attachment-test", version: "1.0.0" });
    registerAttachmentTool(server);
    registerAttachmentResources(server);
    const client = new Client({ name: "attachment-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "mcp_kanban_attachment_manager",
            annotations: expect.objectContaining({ readOnlyHint: true }),
          }),
        ]),
      );
      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            uriTemplate: "planka-attachment://{cardId}/{attachmentId}",
          }),
        ]),
      );

      const toolResult = await client.callTool({
        name: "mcp_kanban_attachment_manager",
        arguments: { action: "read", cardId: "card-1", attachmentId: "attachment-1" },
      });
      expect((toolResult.content as Array<unknown>)[1]).toMatchObject({ type: "resource" });

      const resourceResult = await client.readResource({
        uri: "planka-attachment://card-1/attachment-1",
      });
      expect(resourceResult.contents).toEqual([
        {
          uri: "planka-attachment://card-1/attachment-1",
          mimeType: "application/pdf",
          blob: Buffer.from(bytes).toString("base64"),
        },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
