import { ArkErrors, scope } from "arktype";

const GmailSchemas = scope({
  GmailHeader: { name: "string", value: "string" },
  GmailMessageBody: {
    "data?": "string",
    "size?": "number",
    "attachmentId?": "string",
  },
  GmailMessagePart: {
    "mimeType?": "string",
    "filename?": "string",
    "headers?": "GmailHeader[]",
    "body?": "GmailMessageBody",
    "parts?": "GmailMessagePart[]",
  },
  GmailMessage: {
    id: "string",
    "threadId?": "string",
    "labelIds?": "string[]",
    "snippet?": "string",
    "historyId?": "string",
    "internalDate?": "string",
    "sizeEstimate?": "number",
    "raw?": "string",
    "payload?": "GmailMessagePart",
  },
  GmailThread: {
    id: "string",
    "historyId?": "string",
    "messages?": "GmailMessage[]",
  },
  GmailThreadReference: {
    id: "string",
    "snippet?": "string",
    "historyId?": "string",
  },
  GmailMessageReference: { id: "string", "threadId?": "string" },
  GmailDraft: { id: "string", "message?": "GmailMessage" },
  GmailLabel: {
    id: "string",
    name: "string",
    "type?": "string",
    "labelListVisibility?": "string",
    "messageListVisibility?": "string",
  },
  GmailListThreadsResponse: {
    "threads?": "GmailThreadReference[]",
    "nextPageToken?": "string",
    "resultSizeEstimate?": "number",
  },
  GmailListMessagesResponse: {
    "messages?": "GmailMessageReference[]",
    "nextPageToken?": "string",
    "resultSizeEstimate?": "number",
  },
  GmailListDraftsResponse: {
    "drafts?": "GmailDraft[]",
    "nextPageToken?": "string",
    "resultSizeEstimate?": "number",
  },
  GmailListLabelsResponse: { "labels?": "GmailLabel[]" },
}).export();

export const GmailHeaderSchema = GmailSchemas.GmailHeader;
export type GmailHeader = typeof GmailHeaderSchema.infer;

export const GmailMessagePartSchema = GmailSchemas.GmailMessagePart;
export type GmailMessagePart = typeof GmailMessagePartSchema.infer;

export const GmailMessageSchema = GmailSchemas.GmailMessage;
export type GmailMessage = typeof GmailMessageSchema.infer;

export const GmailThreadSchema = GmailSchemas.GmailThread;
export type GmailThread = typeof GmailThreadSchema.infer;

export const GmailDraftSchema = GmailSchemas.GmailDraft;
export type GmailDraft = typeof GmailDraftSchema.infer;

export const GmailListThreadsResponseSchema =
  GmailSchemas.GmailListThreadsResponse;
export type GmailListThreadsResponse =
  typeof GmailListThreadsResponseSchema.infer;

export const GmailListMessagesResponseSchema =
  GmailSchemas.GmailListMessagesResponse;
export type GmailListMessagesResponse =
  typeof GmailListMessagesResponseSchema.infer;

export const GmailListDraftsResponseSchema =
  GmailSchemas.GmailListDraftsResponse;
export type GmailListDraftsResponse =
  typeof GmailListDraftsResponseSchema.infer;

export const GmailListLabelsResponseSchema =
  GmailSchemas.GmailListLabelsResponse;
export type GmailListLabelsResponse =
  typeof GmailListLabelsResponseSchema.infer;

export type GmailResponseSchema<T> = (response: unknown) => T | ArkErrors;

export function parseGmailResponse<T>(
  schema: GmailResponseSchema<T>,
  response: unknown,
  operation: string,
): T {
  const result = schema(response);
  if (result instanceof ArkErrors) {
    throw new Error(
      `Gmail API response did not match the expected ${operation} shape`,
      { cause: result },
    );
  }
  return result;
}
