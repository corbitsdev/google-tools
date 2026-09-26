import { GmailApiError } from "./errors.js";
import {
  GmailDraftSchema,
  GmailListDraftsResponseSchema,
  GmailListLabelsResponseSchema,
  GmailListMessagesResponseSchema,
  GmailListThreadsResponseSchema,
  GmailMessageSchema,
  GmailThreadSchema,
  parseGmailResponse,
  type GmailDraft,
  type GmailListDraftsResponse,
  type GmailListLabelsResponse,
  type GmailListMessagesResponse,
  type GmailListThreadsResponse,
  type GmailMessage,
  type GmailResponseSchema,
  type GmailThread,
} from "./schemas.js";

export { GmailApiError } from "./errors.js";
export type {
  GmailDraft,
  GmailHeader,
  GmailListDraftsResponse,
  GmailListLabelsResponse,
  GmailListMessagesResponse,
  GmailListThreadsResponse,
  GmailMessage,
  GmailMessagePart,
  GmailThread,
} from "./schemas.js";

export const GMAIL_API_BASE_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailQueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | undefined
  | null;

export type GmailRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, GmailQueryValue> | undefined;
  body?: unknown;
  signal?: AbortSignal | undefined;
};

export type GmailFormat = "full" | "metadata" | "minimal";

export type GmailModifyLabels = {
  addLabelIds?: readonly string[] | undefined;
  removeLabelIds?: readonly string[] | undefined;
};

export type GmailFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GmailClient = {
  listThreads(options: {
    query?: string | undefined;
    pageSize: number;
    pageToken?: string | undefined;
    includeTrash: boolean;
    signal?: AbortSignal | undefined;
  }): Promise<GmailListThreadsResponse>;
  getThread(
    id: string,
    options: {
      format: GmailFormat;
      metadataHeaders?: readonly string[] | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<GmailThread>;
  getMessage(
    id: string,
    options: {
      format: GmailFormat;
      metadataHeaders?: readonly string[] | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<GmailMessage>;
  listDrafts(options: {
    pageSize: number;
    pageToken?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<GmailListDraftsResponse>;
  listMessages(options: {
    query: string;
    pageSize: number;
    pageToken?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<GmailListMessagesResponse>;
  getDraft(
    id: string,
    options: {
      format: GmailFormat;
      metadataHeaders?: readonly string[] | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<GmailDraft>;
  createDraft(options: {
    raw: string;
    threadId?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<GmailDraft>;
  modifyMessage(
    id: string,
    labels: GmailModifyLabels,
    signal?: AbortSignal,
  ): Promise<GmailMessage>;
  modifyThread(
    id: string,
    labels: GmailModifyLabels,
    signal?: AbortSignal,
  ): Promise<GmailThread>;
  listLabels(signal?: AbortSignal): Promise<GmailListLabelsResponse>;
};

export type CreateGmailClientOptions = { fetchImpl: GmailFetch };

const REQUEST_TIMEOUT_MS = 30_000;

function joinUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    throw new Error("Gmail API request path must be relative");
  }
  return `${GMAIL_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function applyQuery(
  url: URL,
  query: Record<string, GmailQueryValue> | undefined,
): void {
  if (query === undefined) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function responseBodyError(
  status: number,
  message: string,
  cause: unknown,
): Error {
  return new Error(
    `Gmail API request failed: ${message} (status ${String(status)})`,
    { cause },
  );
}

export function createGmailClient({
  fetchImpl,
}: CreateGmailClientOptions): GmailClient {
  if (typeof fetchImpl !== "function") {
    throw new Error("createGmailClient: provide fetchImpl");
  }

  async function request<T>(
    requestOptions: GmailRequest,
    responseSchema: GmailResponseSchema<T>,
    operation: string,
  ): Promise<T> {
    const url = new URL(joinUrl(requestOptions.path));
    applyQuery(url, requestOptions.query);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    let body: string | undefined;
    if (requestOptions.body !== undefined) {
      body = JSON.stringify(requestOptions.body);
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: requestOptions.method,
        headers,
        body,
        signal: requestSignal(requestOptions.signal),
      });
    } catch (cause) {
      throw new Error(
        `Gmail API request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch (cause) {
      throw responseBodyError(
        response.status,
        "could not read response body",
        cause,
      );
    }

    if (!response.ok) {
      throw new GmailApiError(response.status, response.statusText, raw);
    }

    if (raw.length === 0) {
      throw responseBodyError(
        response.status,
        "response body was empty",
        undefined,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw responseBodyError(response.status, "invalid JSON body", cause);
    }
    return parseGmailResponse(responseSchema, parsed, operation);
  }

  return {
    listThreads: (options) =>
      request(
        {
          method: "GET",
          path: "/threads",
          query: {
            q: options.query,
            maxResults: options.pageSize,
            pageToken: options.pageToken,
            includeSpamTrash: options.includeTrash,
          },
          signal: options.signal,
        },
        GmailListThreadsResponseSchema,
        "list-threads",
      ),
    getThread: (id, options) =>
      request(
        {
          method: "GET",
          path: `/threads/${encodeURIComponent(id)}`,
          query: {
            format: options.format,
            metadataHeaders: options.metadataHeaders,
          },
          signal: options.signal,
        },
        GmailThreadSchema,
        "get-thread",
      ),
    getMessage: (id, options) =>
      request(
        {
          method: "GET",
          path: `/messages/${encodeURIComponent(id)}`,
          query: {
            format: options.format,
            metadataHeaders: options.metadataHeaders,
          },
          signal: options.signal,
        },
        GmailMessageSchema,
        "get-message",
      ),
    listDrafts: (options) =>
      request(
        {
          method: "GET",
          path: "/drafts",
          query: {
            maxResults: options.pageSize,
            pageToken: options.pageToken,
          },
          signal: options.signal,
        },
        GmailListDraftsResponseSchema,
        "list-drafts",
      ),
    listMessages: (options) =>
      request(
        {
          method: "GET",
          path: "/messages",
          query: {
            q: options.query,
            maxResults: options.pageSize,
            pageToken: options.pageToken,
          },
          signal: options.signal,
        },
        GmailListMessagesResponseSchema,
        "list-messages",
      ),
    getDraft: (id, options) =>
      request(
        {
          method: "GET",
          path: `/drafts/${encodeURIComponent(id)}`,
          query: {
            format: options.format,
            metadataHeaders: options.metadataHeaders,
          },
          signal: options.signal,
        },
        GmailDraftSchema,
        "get-draft",
      ),
    createDraft: (options) =>
      request(
        {
          method: "POST",
          path: "/drafts",
          body: {
            message: {
              raw: options.raw,
              ...(options.threadId === undefined
                ? {}
                : { threadId: options.threadId }),
            },
          },
          signal: options.signal,
        },
        GmailDraftSchema,
        "create-draft",
      ),
    modifyMessage: (id, labels, signal) =>
      request(
        {
          method: "POST",
          path: `/messages/${encodeURIComponent(id)}/modify`,
          body: labels,
          signal,
        },
        GmailMessageSchema,
        "modify-message",
      ),
    modifyThread: (id, labels, signal) =>
      request(
        {
          method: "POST",
          path: `/threads/${encodeURIComponent(id)}/modify`,
          body: labels,
          signal,
        },
        GmailThreadSchema,
        "modify-thread",
      ),
    listLabels: (signal) =>
      request(
        { method: "GET", path: "/labels", signal },
        GmailListLabelsResponseSchema,
        "list-labels",
      ),
  };
}
