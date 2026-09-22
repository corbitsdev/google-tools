import type { ToolDefinition } from "@intx/types/runtime";

import {
  CreateDraftInput,
  createInputJSONSchema,
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

export const GMAIL_CREDENTIAL_HANDLE = "gmail-api";

export type GmailToolCatalogEntry = ToolDefinition & { approval?: "ask" };

export const GMAIL_TOOL_CATALOG: GmailToolCatalogEntry[] = [
  {
    name: "gmail_search_threads",
    description:
      "Search the authenticated Gmail mailbox and return thread summaries with an optional next page token.",
    inputSchema: createInputJSONSchema(SearchThreadsInput),
  },
  {
    name: "gmail_get_thread",
    description: "Fetch one Gmail thread with selected message detail.",
    inputSchema: createInputJSONSchema(GetThreadInput),
  },
  {
    name: "gmail_get_message",
    description: "Fetch one Gmail message with selected detail.",
    inputSchema: createInputJSONSchema(GetMessageInput),
  },
  {
    name: "gmail_list_labels",
    description: "List labels available in the authenticated Gmail mailbox.",
    inputSchema: createInputJSONSchema(ListLabelsInput),
  },
  {
    name: "gmail_create_draft",
    description:
      "Create a Gmail draft. Attachments are accepted by the schema for Google compatibility but are not supported by Gmail's MCP draft flow.",
    inputSchema: createInputJSONSchema(CreateDraftInput),
    approval: "ask",
  },
  {
    name: "gmail_list_drafts",
    description: "List Gmail drafts with Gmail-query filtering and pagination.",
    inputSchema: createInputJSONSchema(ListDraftsInput),
  },
  {
    name: "gmail_label_message",
    description: "Add one or more labels to a Gmail message.",
    inputSchema: createInputJSONSchema(LabelMessageInput),
    approval: "ask",
  },
  {
    name: "gmail_unlabel_message",
    description: "Remove one or more labels from a Gmail message.",
    inputSchema: createInputJSONSchema(UnlabelMessageInput),
    approval: "ask",
  },
  {
    name: "gmail_label_thread",
    description: "Add one or more labels to every message in a Gmail thread.",
    inputSchema: createInputJSONSchema(LabelThreadInput),
    approval: "ask",
  },
  {
    name: "gmail_unlabel_thread",
    description: "Remove one or more labels from every message in a Gmail thread.",
    inputSchema: createInputJSONSchema(UnlabelThreadInput),
    approval: "ask",
  },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = GMAIL_TOOL_CATALOG.map(
  ({ approval: _approval, ...definition }) => definition,
);
