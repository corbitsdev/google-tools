import { type } from "arktype";

const DraftAttachmentInput = type({
  "+": "reject",
  "id?": type("string").describe("External attachment ID."),
  "filename?": type("string").describe("Attachment filename."),
  "mimeType?": type("string").describe("IANA media type."),
  content: type("string").describe("Base64-encoded file content."),
  "inline?": type("boolean").describe("Whether the attachment is inline."),
});

export const SearchThreadsInput = type({
  "+": "reject",
  "query?": type("string").describe(
    "Gmail search query, for example from:alice@example.com.",
  ),
  pageSize: type("1 <= number.integer <= 50")
    .describe("Maximum number of threads to return; defaults to 20.")
    .default(20),
  "pageToken?": type("string").describe(
    "Gmail page token returned by a previous search.",
  ),
  includeTrash: type("boolean")
    .describe("Whether to include threads from Gmail Trash.")
    .default(false),
  view: type("'THREAD_VIEW_MINIMAL' | 'THREAD_VIEW_METADATA_ONLY'")
    .describe("Controls the message fields returned with each thread.")
    .default("THREAD_VIEW_MINIMAL"),
});
export type SearchThreadsInput = typeof SearchThreadsInput.infer;

export const GetThreadInput = type({
  "+": "reject",
  threadId: type("string > 0").describe("Gmail thread ID."),
  messageFormat: type("'FULL_CONTENT' | 'METADATA_ONLY' | 'MINIMAL'")
    .describe("Controls the level of message detail returned.")
    .default("FULL_CONTENT"),
});
export type GetThreadInput = typeof GetThreadInput.infer;

export const GetMessageInput = type({
  "+": "reject",
  messageId: type("string > 0").describe("Gmail message ID."),
  messageFormat: type("'FULL_CONTENT' | 'METADATA_ONLY' | 'MINIMAL'")
    .describe("Controls the level of message detail returned.")
    .default("FULL_CONTENT"),
});
export type GetMessageInput = typeof GetMessageInput.infer;

export const ListLabelsInput = type({ "+": "reject" });
export type ListLabelsInput = typeof ListLabelsInput.infer;

export const CreateDraftInput = type({
  "+": "reject",
  "to?": type("string[]").describe(
    "Primary recipient addresses, including RFC 5322 display-name forms.",
  ),
  "cc?": type("string[]").describe(
    "Carbon-copy recipient addresses, including RFC 5322 display-name forms.",
  ),
  "bcc?": type("string[]").describe(
    "Blind-carbon-copy recipient addresses, including RFC 5322 display-name forms.",
  ),
  "subject?": type("string").describe("Draft subject; defaults to empty."),
  "body?": type("string").describe("Plain-text draft body."),
  "htmlBody?": type("string").describe("Rich-text HTML draft body."),
  "replyToMessageId?": type("string > 0").describe(
    "Message ID to reply to in the same Gmail thread.",
  ),
  "attachments?": DraftAttachmentInput.array().describe(
    "Reserved for Google compatibility; Gmail MCP drafts do not currently support attachments.",
  ),
});
export type CreateDraftInput = typeof CreateDraftInput.infer;

export const ListDraftsInput = type({
  "+": "reject",
  pageSize: type("1 <= number.integer <= 50")
    .describe("Maximum number of drafts to return; defaults to 20.")
    .default(20),
  "pageToken?": type("string").describe("Page token from a previous list."),
  "query?": type("string").describe("Gmail draft search query."),
  view: type("'DRAFT_VIEW_FULL' | 'DRAFT_VIEW_METADATA_ONLY'")
    .describe("Controls whether draft subject and bodies are returned.")
    .default("DRAFT_VIEW_FULL"),
});
export type ListDraftsInput = typeof ListDraftsInput.infer;

const LabelIds = type("string[] > 0").describe(
  "Gmail system or user label IDs.",
);

export const LabelMessageInput = type({
  "+": "reject",
  messageId: type("string > 0").describe("Gmail message ID."),
  labelIds: LabelIds,
});
export type LabelMessageInput = typeof LabelMessageInput.infer;

export const UnlabelMessageInput = type({
  "+": "reject",
  messageId: type("string > 0").describe("Gmail message ID."),
  labelIds: LabelIds,
});
export type UnlabelMessageInput = typeof UnlabelMessageInput.infer;

export const LabelThreadInput = type({
  "+": "reject",
  threadId: type("string > 0").describe("Gmail thread ID."),
  labelIds: LabelIds,
});
export type LabelThreadInput = typeof LabelThreadInput.infer;

export const UnlabelThreadInput = type({
  "+": "reject",
  threadId: type("string > 0").describe("Gmail thread ID."),
  labelIds: LabelIds,
});
export type UnlabelThreadInput = typeof UnlabelThreadInput.infer;

export function createInputJSONSchema(input: {
  toJsonSchema: (options: { target: "draft-07" }) => unknown;
}): Record<string, unknown> {
  const schema = input.toJsonSchema({ target: "draft-07" });
  if (!isRecord(schema)) {
    throw new Error("tool input schema must be a JSON object");
  }
  return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
