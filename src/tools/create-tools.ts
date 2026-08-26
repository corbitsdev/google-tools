import { ArkErrors, type Type } from "arktype";
import type {
  ToolCall,
  ToolDefinition,
  ToolResult,
  ToolRunner,
} from "@intx/types/runtime";
import type { HttpMediatedCredential } from "@intx/types";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";

import {
  createGmailClient,
  type GmailClient,
  type GmailDraft,
  type GmailFetch,
  type GmailFormat,
} from "../client/index.js";
import { GMAIL_CREDENTIAL_HANDLE, TOOL_DEFINITIONS } from "./definitions.js";
import {
  metadataHeadersForView,
  toToolDraft,
  toThreadListMessage,
  toToolMessage,
  toToolThread,
  type GmailMessageFormat,
  type GmailThreadView,
} from "./models.js";
import { createRawDraft, type ReplyContext } from "./drafts.js";
import {
  CreateDraftInput,
  GetMessageInput,
  GetThreadInput,
  LabelMessageInput,
  LabelThreadInput,
  ListDraftsInput,
  ListLabelsInput,
  SearchThreadsInput,
  UnlabelMessageInput,
  UnlabelThreadInput,
} from "./schemas.js";

export type CreateGmailToolsOptions = { capabilities: RuntimeCapabilities };

export interface GmailTools extends ToolRunner {
  readonly definitions: ToolDefinition[];
  dispose(): Promise<void>;
}

type GmailToolHandler = (
  client: GmailClient,
  call: ToolCall,
  signal: AbortSignal,
) => Promise<ToolResult>;

const MAX_THREAD_LOOKUPS_IN_FLIGHT = 10;

function parseToolInput<T extends Type>(
  validator: T,
  input: unknown,
): T["infer"] {
  const result = validator(input);
  if (result instanceof ArkErrors) {
    throw new Error(`invalid tool input: ${result.summary}`);
  }
  return result;
}

function rejectUnsupportedAttachments(attachments: readonly unknown[] | undefined): void {
  if (attachments !== undefined && attachments.length > 0) {
    throw new Error("gmail_create_draft: attachments are not supported by Gmail MCP drafts");
  }
}

function toGmailFormat(format: GmailMessageFormat): GmailFormat {
  switch (format) {
    case "FULL_CONTENT":
      return "full";
    case "METADATA_ONLY":
      return "metadata";
    case "MINIMAL":
      return "metadata";
  }
}

function metadataHeadersForFormat(format: GmailMessageFormat): readonly string[] | undefined {
  if (format === "METADATA_ONLY") return undefined;
  return ["Subject", "From", "To", "Cc", "Date"];
}

function draftFormat(view: "DRAFT_VIEW_FULL" | "DRAFT_VIEW_METADATA_ONLY"): GmailMessageFormat {
  return view === "DRAFT_VIEW_FULL" ? "FULL_CONTENT" : "METADATA_ONLY";
}

function headerValue(
  message: { payload?: { headers?: Array<{ name: string; value: string }> } },
  name: string,
): string | undefined {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function plainEmailAddress(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const angleAddress = /<([^<>]+)>/.exec(value)?.[1];
  return (angleAddress ?? value).trim();
}

async function replyContext(
  client: GmailClient,
  messageId: string | undefined,
  signal: AbortSignal,
): Promise<ReplyContext | undefined> {
  if (messageId === undefined) return undefined;
  const original = await client.getMessage(messageId, { format: "full", signal });
  const normalized = toToolMessage(original, "FULL_CONTENT");
  const originalMessageId = headerValue(original, "Message-ID");
  const originalReferences = headerValue(original, "References");
  const recipient = inputRecipients(original, normalized);
  return {
    ...(original.threadId === undefined ? {} : { threadId: original.threadId }),
    ...(originalMessageId === undefined ? {} : { messageId: originalMessageId }),
    ...(originalReferences === undefined ? {} : { references: originalReferences }),
    ...(normalized.subject === undefined ? {} : { subject: normalized.subject }),
    ...(normalized.plaintextBody === undefined
      ? {}
      : { plaintextBody: normalized.plaintextBody }),
    ...(normalized.htmlBody === undefined ? {} : { htmlBody: normalized.htmlBody }),
    ...(recipient === undefined ? {} : { to: recipient }),
  };
}

function inputRecipients(
  original: { labelIds?: readonly string[] },
  normalized: ReturnType<typeof toToolMessage>,
): readonly string[] | undefined {
  const replyAddress = original.labelIds?.includes("SENT")
    ? normalized.toRecipients?.[0]
    : normalized.sender;
  const recipient = plainEmailAddress(replyAddress);
  return recipient === undefined || recipient.length === 0 ? undefined : [recipient];
}

async function listDraftsForQuery(
  client: GmailClient,
  query: string,
  pageSize: number,
  pageToken: string | undefined,
  signal: AbortSignal,
): Promise<{ drafts: GmailDraft[]; nextPageToken?: string }> {
  const matchingMessages = await client.listMessages({
    query: `in:drafts ${query}`,
    pageSize,
    pageToken,
    signal,
  });
  const matchingMessageIds = new Set((matchingMessages.messages ?? []).map((message) => message.id));
  const draftsByMessageId = new Map<string, GmailDraft>();
  let draftsPageToken: string | undefined;
  while (matchingMessageIds.size > 0) {
    const draftPage = await client.listDrafts({
      pageSize: 500,
      pageToken: draftsPageToken,
      signal,
    });
    for (const draft of draftPage.drafts ?? []) {
      if (draft.message?.id !== undefined && matchingMessageIds.delete(draft.message.id)) {
        draftsByMessageId.set(draft.message.id, draft);
      }
    }
    draftsPageToken = draftPage.nextPageToken;
    if (draftsPageToken === undefined) break;
  }

  const drafts = (matchingMessages.messages ?? []).flatMap((message) => {
    const draft = draftsByMessageId.get(message.id);
    return draft === undefined ? [] : [draft];
  });
  return {
    drafts,
    ...(matchingMessages.nextPageToken === undefined
      ? {}
      : { nextPageToken: matchingMessages.nextPageToken }),
  };
}

async function lookupThreads(
  client: GmailClient,
  threadIds: readonly string[],
  view: GmailThreadView,
  signal: AbortSignal,
) {
  const threads = new Array<{
    id: string;
    messages: ReturnType<typeof toThreadListMessage>[];
  }>(threadIds.length);
  let nextIndex = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      signal.throwIfAborted();
      const index = nextIndex;
      nextIndex += 1;
      if (index >= threadIds.length) return;
      const threadId = threadIds[index];
      if (threadId === undefined) return;
      try {
        const fullThread = await client.getThread(threadId, {
          format: "metadata",
          metadataHeaders: metadataHeadersForView(view),
          signal,
        });
        threads[index] = {
          id: fullThread.id,
          messages: (fullThread.messages ?? []).map((message) => toThreadListMessage(message, view)),
        };
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(threadIds.length, MAX_THREAD_LOOKUPS_IN_FLIGHT) }, worker),
  );
  return threads;
}

const HANDLERS = new Map<string, GmailToolHandler>([
  [
    "gmail_search_threads",
    async (client, call, signal) => {
      const input = parseToolInput(SearchThreadsInput, call.arguments);
      const response = await client.listThreads({
        query: input.query,
        pageToken: input.pageToken,
        pageSize: input.pageSize,
        includeTrash: input.includeTrash,
        signal,
      });
      const threads = await lookupThreads(
        client,
        (response.threads ?? []).map((thread) => thread.id),
        input.view,
        signal,
      );
      return {
        callId: call.id,
        content: {
          data: {
            threads,
            ...(response.nextPageToken === undefined
              ? {}
              : { nextPageToken: response.nextPageToken }),
            ...(response.resultSizeEstimate === undefined
              ? {}
              : { resultCountEstimate: String(response.resultSizeEstimate) }),
          },
        },
      };
    },
  ],
  [
    "gmail_get_thread",
    async (client, call, signal) => {
      const input = parseToolInput(GetThreadInput, call.arguments);
      const thread = await client.getThread(input.threadId, {
        format: toGmailFormat(input.messageFormat),
        metadataHeaders: metadataHeadersForFormat(input.messageFormat),
        signal,
      });
      return {
        callId: call.id,
        content: { data: toToolThread(thread, input.messageFormat) },
      };
    },
  ],
  [
    "gmail_get_message",
    async (client, call, signal) => {
      const input = parseToolInput(GetMessageInput, call.arguments);
      const message = await client.getMessage(input.messageId, {
        format: toGmailFormat(input.messageFormat),
        metadataHeaders: metadataHeadersForFormat(input.messageFormat),
        signal,
      });
      return {
        callId: call.id,
        content: { data: toToolMessage(message, input.messageFormat) },
      };
    },
  ],
  [
    "gmail_list_labels",
    async (client, call, signal) => {
      parseToolInput(ListLabelsInput, call.arguments);
      const response = await client.listLabels(signal);
      return {
        callId: call.id,
        content: { data: { labels: response.labels ?? [] } },
      };
    },
  ],
  [
    "gmail_create_draft",
    async (client, call, signal) => {
      const input = parseToolInput(CreateDraftInput, call.arguments);
      rejectUnsupportedAttachments(input.attachments);
      const { attachments: _attachments, replyToMessageId, ...draft } = input;
      const reply = await replyContext(client, replyToMessageId, signal);
      const created = await client.createDraft({
        raw: createRawDraft(draft, reply),
        ...(reply?.threadId === undefined ? {} : { threadId: reply.threadId }),
        signal,
      });
      return {
        callId: call.id,
        content: { data: toToolDraft(created, "FULL_CONTENT") },
      };
    },
  ],
  [
    "gmail_list_drafts",
    async (client, call, signal) => {
      const input = parseToolInput(ListDraftsInput, call.arguments);
      const format = draftFormat(input.view);
      const response =
        input.query === undefined
          ? await client.listDrafts({
              pageSize: input.pageSize,
              pageToken: input.pageToken,
              signal,
            })
          : await listDraftsForQuery(
              client,
              input.query,
              input.pageSize,
              input.pageToken,
              signal,
            );
      const drafts = await Promise.all(
        (response.drafts ?? []).map(async (draft) =>
          toToolDraft(
            await client.getDraft(draft.id, {
              format: toGmailFormat(format),
              metadataHeaders: metadataHeadersForFormat(format),
              signal,
            }),
            format,
          ),
        ),
      );
      return {
        callId: call.id,
        content: {
          data: {
            drafts,
            ...(response.nextPageToken === undefined
              ? {}
              : { nextPageToken: response.nextPageToken }),
          },
        },
      };
    },
  ],
  [
    "gmail_label_message",
    async (client, call, signal) => {
      const input = parseToolInput(LabelMessageInput, call.arguments);
      const message = await client.modifyMessage(
        input.messageId,
        { addLabelIds: input.labelIds },
        signal,
      );
      return {
        callId: call.id,
        content: { data: toToolMessage(message, "METADATA_ONLY") },
      };
    },
  ],
  [
    "gmail_unlabel_message",
    async (client, call, signal) => {
      const input = parseToolInput(UnlabelMessageInput, call.arguments);
      const message = await client.modifyMessage(
        input.messageId,
        { removeLabelIds: input.labelIds },
        signal,
      );
      return {
        callId: call.id,
        content: { data: toToolMessage(message, "METADATA_ONLY") },
      };
    },
  ],
  [
    "gmail_label_thread",
    async (client, call, signal) => {
      const input = parseToolInput(LabelThreadInput, call.arguments);
      const thread = await client.modifyThread(
        input.threadId,
        { addLabelIds: input.labelIds },
        signal,
      );
      return {
        callId: call.id,
        content: { data: toToolThread(thread, "METADATA_ONLY") },
      };
    },
  ],
  [
    "gmail_unlabel_thread",
    async (client, call, signal) => {
      const input = parseToolInput(UnlabelThreadInput, call.arguments);
      const thread = await client.modifyThread(
        input.threadId,
        { removeLabelIds: input.labelIds },
        signal,
      );
      return {
        callId: call.id,
        content: { data: toToolThread(thread, "METADATA_ONLY") },
      };
    },
  ],
]);

export function createGmailTools(opts: CreateGmailToolsOptions): GmailTools {
  assertCatalogMatchesHandlers();
  let clientPromise: Promise<GmailClient> | undefined;
  let mediated: HttpMediatedCredential | undefined;
  let disposed = false;

  async function getClient(): Promise<GmailClient> {
    const pendingClient =
      clientPromise ??
      (clientPromise = (async () => {
        const credentials = opts.capabilities.resolve("credentials");
        const resolved = await credentials.resolve(GMAIL_CREDENTIAL_HANDLE);
        if (resolved.kind !== "http") {
          throw new Error(
            `gmail-tools: expected http mediated credential for handle "${GMAIL_CREDENTIAL_HANDLE}", got ${resolved.kind}`,
          );
        }
        mediated = resolved;
        const fetchImpl: GmailFetch = (input, init) => resolved.fetch(input, init);
        return createGmailClient({
          fetchImpl,
        });
      })());

    try {
      return await pendingClient;
    } catch (error) {
      if (clientPromise === pendingClient) clientPromise = undefined;
      throw error;
    }
  }

  return {
    definitions: TOOL_DEFINITIONS,
    async run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      const handler = HANDLERS.get(call.name);
      if (handler === undefined) {
        return {
          callId: call.id,
          content: { error: `Unknown tool: "${call.name}"` },
          isError: true,
        };
      }

      try {
        return await handler(await getClient(), call, signal);
      } catch (error) {
        return {
          callId: call.id,
          content: {
            error: error instanceof Error ? error.message : String(error),
          },
          isError: true,
        };
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (clientPromise !== undefined) {
        await clientPromise.catch(() => undefined);
      }
      await mediated?.dispose();
    },
  };
}

function assertCatalogMatchesHandlers(): void {
  const definitions = TOOL_DEFINITIONS.map((definition) => definition.name).sort();
  const handlers = [...HANDLERS.keys()].sort();
  if (JSON.stringify(definitions) !== JSON.stringify(handlers)) {
    throw new Error(
      `gmail-tools: definitions and handlers differ (${definitions.join(", ")} vs ${handlers.join(", ")})`,
    );
  }
}
