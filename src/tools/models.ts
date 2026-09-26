import type {
  GmailDraft,
  GmailHeader,
  GmailMessage,
  GmailMessagePart,
  GmailThread,
} from "../client/index.js";

export type GmailMessageFormat = "FULL_CONTENT" | "METADATA_ONLY" | "MINIMAL";
export type GmailThreadView =
  | "THREAD_VIEW_METADATA_ONLY"
  | "THREAD_VIEW_MINIMAL";

export type GmailAttachment = {
  id: string;
  mimeType?: string;
  filename?: string;
};

export type GmailToolMessage = {
  id: string;
  threadId?: string;
  labelIds: string[];
  sizeEstimate?: number;
  date?: string;
  snippet?: string;
  subject?: string;
  sender?: string;
  toRecipients?: string[];
  ccRecipients?: string[];
  bccRecipients?: string[];
  plaintextBody?: string;
  htmlBody?: string;
  attachmentIds?: string[];
  attachments?: GmailAttachment[];
};

export type GmailToolThread = {
  id: string;
  messages: GmailToolMessage[];
};

export type GmailToolDraft = Omit<
  GmailToolMessage,
  | "id"
  | "labelIds"
  | "sizeEstimate"
  | "snippet"
  | "sender"
  | "attachmentIds"
  | "attachments"
> & {
  id: string;
};

const THREAD_METADATA_HEADERS: readonly string[] = ["From", "To", "Cc", "Date"];
const THREAD_MINIMAL_HEADERS: readonly string[] = [
  "Subject",
  ...THREAD_METADATA_HEADERS,
];

function headersByName(
  headers: GmailHeader[] | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const header of headers ?? []) {
    const name = header.name.trim().toLowerCase();
    if (name.length > 0 && !result.has(name)) result.set(name, header.value);
  }
  return result;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}

function collectParts(part: GmailMessagePart | undefined): GmailMessagePart[] {
  if (part === undefined) return [];
  return [part, ...(part.parts ?? []).flatMap(collectParts)];
}

function bodyForMimeType(
  parts: GmailMessagePart[],
  mimeType: string,
): string | undefined {
  const values = parts.flatMap((part) => {
    if (
      part.mimeType !== mimeType ||
      part.body?.data === undefined ||
      part.body.attachmentId !== undefined ||
      (part.filename !== undefined && part.filename.length > 0)
    ) {
      return [];
    }
    return [decodeBase64Url(part.body.data)];
  });
  return values.length === 0 ? undefined : values.join("\n\n");
}

function recipients(value: string | undefined): string[] | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const result: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "<") {
      angleDepth += 1;
    } else if (character === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (character === "," && angleDepth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function dateFromMessage(
  message: GmailMessage,
  headerDate: string | undefined,
): string | undefined {
  const source = headerDate ?? message.internalDate;
  if (source === undefined) return undefined;
  const timestamp =
    headerDate === undefined ? Number(source) : Date.parse(source);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function baseMessage(message: GmailMessage): GmailToolMessage {
  const headers = headersByName(message.payload?.headers);
  const date = dateFromMessage(message, headers.get("date"));
  return {
    id: message.id,
    ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
    labelIds: message.labelIds ?? [],
    ...(message.sizeEstimate === undefined
      ? {}
      : { sizeEstimate: message.sizeEstimate }),
    ...(date === undefined ? {} : { date }),
  };
}

function messageMetadata(
  message: GmailMessage,
  includeSubject: boolean,
): GmailToolMessage {
  const headers = headersByName(message.payload?.headers);
  const toRecipients = recipients(headers.get("to"));
  const ccRecipients = recipients(headers.get("cc"));
  const bccRecipients = recipients(headers.get("bcc"));
  return {
    ...baseMessage(message),
    ...(includeSubject && message.snippet !== undefined
      ? { snippet: message.snippet }
      : {}),
    ...(includeSubject && headers.get("subject") !== undefined
      ? { subject: headers.get("subject") }
      : {}),
    ...(headers.get("from") === undefined
      ? {}
      : { sender: headers.get("from") }),
    ...(toRecipients === undefined ? {} : { toRecipients }),
    ...(ccRecipients === undefined ? {} : { ccRecipients }),
    ...(bccRecipients === undefined ? {} : { bccRecipients }),
  };
}

function attachments(parts: GmailMessagePart[]): GmailAttachment[] {
  return parts.flatMap((part) => {
    const id = part.body?.attachmentId;
    if (id === undefined) return [];
    return [
      {
        id,
        ...(part.mimeType === undefined ? {} : { mimeType: part.mimeType }),
        ...(part.filename === undefined || part.filename.length === 0
          ? {}
          : { filename: part.filename }),
      },
    ];
  });
}

export function metadataHeadersForView(
  view: GmailThreadView,
): readonly string[] {
  return view === "THREAD_VIEW_MINIMAL"
    ? THREAD_MINIMAL_HEADERS
    : THREAD_METADATA_HEADERS;
}

export function toToolMessage(
  message: GmailMessage,
  format: GmailMessageFormat,
): GmailToolMessage {
  if (format === "METADATA_ONLY") return baseMessage(message);

  const metadata = messageMetadata(message, true);
  if (format === "MINIMAL") return metadata;

  const parts = collectParts(message.payload);
  const messageAttachments = attachments(parts);
  const plaintextBody = bodyForMimeType(parts, "text/plain");
  const htmlBody = bodyForMimeType(parts, "text/html");
  return {
    ...metadata,
    ...(plaintextBody === undefined ? {} : { plaintextBody }),
    ...(htmlBody === undefined ? {} : { htmlBody }),
    ...(messageAttachments.length === 0
      ? {}
      : {
          attachmentIds: messageAttachments.map((attachment) => attachment.id),
          attachments: messageAttachments,
        }),
  };
}

export function toToolThread(
  thread: GmailThread,
  format: GmailMessageFormat,
): GmailToolThread {
  return {
    id: thread.id,
    messages: (thread.messages ?? []).map((message) =>
      toToolMessage(message, format),
    ),
  };
}

export function toToolDraft(
  draft: GmailDraft,
  format: GmailMessageFormat,
): GmailToolDraft {
  if (draft.message === undefined) return { id: draft.id };
  const {
    id: _messageId,
    labelIds: _labelIds,
    sizeEstimate: _sizeEstimate,
    snippet: _snippet,
    sender: _sender,
    attachmentIds: _attachmentIds,
    attachments: _attachments,
    ...message
  } = toToolMessage(draft.message, format);
  return { id: draft.id, ...message };
}

export function toThreadListMessage(
  message: GmailMessage,
  view: GmailThreadView,
): GmailToolMessage {
  if (view === "THREAD_VIEW_MINIMAL") return toToolMessage(message, "MINIMAL");
  return messageMetadata(message, false);
}
