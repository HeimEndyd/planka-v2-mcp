import {
  type PlankaAttachment,
  type PlankaAttachmentMetadata,
  PlankaAttachmentSchema,
} from "../common/types.js";
import { getCardWithIncluded } from "./cards.js";

export const ATTACHMENT_RESOURCE_SCHEME = "planka-attachment";
const SAFE_PLANKA_ID = /^[A-Za-z0-9_-]+$/;

function assertSafePlankaId(value: string, label: string): void {
  if (!SAFE_PLANKA_ID.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }
}

export function buildAttachmentResourceUri(cardId: string, attachmentId: string): string {
  assertSafePlankaId(cardId, "Card ID");
  assertSafePlankaId(attachmentId, "Attachment ID");
  return `${ATTACHMENT_RESOURCE_SCHEME}://${encodeURIComponent(cardId)}/${encodeURIComponent(
    attachmentId,
  )}`;
}

export function toAttachmentMetadata(attachment: PlankaAttachment): PlankaAttachmentMetadata {
  return {
    id: attachment.id,
    cardId: attachment.cardId,
    creatorUserId: attachment.creatorUserId,
    name: attachment.name,
    type: attachment.type,
    mimeType: attachment.type === "file" ? attachment.data.mimeType : null,
    size:
      attachment.type === "file"
        ? (attachment.data.size ?? attachment.data.sizeInBytes ?? null)
        : null,
    url: attachment.data.url,
    resourceUri:
      attachment.type === "file"
        ? buildAttachmentResourceUri(attachment.cardId, attachment.id)
        : null,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

export async function getAttachments(cardId: string): Promise<PlankaAttachment[]> {
  assertSafePlankaId(cardId, "Card ID");
  const cardResponse = await getCardWithIncluded(cardId);
  if (!cardResponse.item) {
    throw new Error(`Card with ID ${cardId} not found`);
  }

  return getAttachmentsFromIncluded(cardId, cardResponse.included);
}

export function getAttachmentsFromIncluded(
  cardId: string,
  included: Record<string, unknown> | undefined,
): PlankaAttachment[] {
  const includedAttachments = Array.isArray(included?.attachments) ? included.attachments : [];
  return includedAttachments
    .map((attachment) => PlankaAttachmentSchema.parse(attachment))
    .filter((attachment) => attachment.cardId === cardId);
}

export async function getAttachment(
  cardId: string,
  attachmentId: string,
): Promise<PlankaAttachment> {
  assertSafePlankaId(attachmentId, "Attachment ID");
  const attachment = (await getAttachments(cardId)).find((item) => item.id === attachmentId);
  if (!attachment) {
    throw new Error(`Attachment ${attachmentId} was not found on card ${cardId}`);
  }
  return attachment;
}
