import type { HttpMediatedCredential } from "@intx/types";

import type { GmailFetch } from "../../src/client/index.js";
import {
  defaultGmailLiveLogger,
  refreshGmailAccessToken,
  type GmailAccessToken,
  type GmailLiveLogger,
  type GmailOAuthConfig,
} from "./oauth.js";
import { getArray, getString, isRecord } from "./json.js";
import type { StoredGmailToken } from "./token-store.js";

export const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";

export type StandaloneGmailCredentialOptions = {
  config: GmailOAuthConfig;
  token: StoredGmailToken;
  fetchImpl?: GmailFetch;
  debug?: boolean;
  showContent?: boolean;
  logger?: GmailLiveLogger;
};

const CONTENT_PREVIEW_LIMIT = 1_000;

function preview(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > CONTENT_PREVIEW_LIMIT
    ? `${normalized.slice(0, CONTENT_PREVIEW_LIMIT)}…`
    : normalized;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
    );
  } catch {
    return "";
  }
}

function messageContentPreview(message: Record<string, unknown>): Record<string, unknown> {
  const payload =
    isRecord(message.payload)
      ? message.payload
      : undefined;
  const headers = payload === undefined ? [] : (getArray(payload, "headers") ?? []);
  const selectedHeaders: Record<string, string> = {};
  for (const header of headers) {
    if (!isRecord(header)) continue;
    const name = getString(header, "name");
    const value = getString(header, "value");
    if (
      typeof name === "string" &&
      typeof value === "string" &&
      ["subject", "from", "to", "cc", "date"].includes(name.toLowerCase())
    ) {
      selectedHeaders[name.toLowerCase()] = value;
    }
  }

  const bodyParts: Record<string, unknown>[] = [];
  const visit = (part: unknown): void => {
    if (!isRecord(part)) return;
    const current = part;
    bodyParts.push(current);
    const parts = getArray(current, "parts");
    if (parts !== undefined) {
      for (const child of parts) visit(child);
    }
  };
  visit(payload);
  const preferredPart = bodyParts.find(
    (part) =>
      getString(part, "mimeType") === "text/plain" && bodyData(part) !== undefined,
  );
  const fallbackPart = bodyParts.find(
    (part) =>
      getString(part, "mimeType") === "text/html" && bodyData(part) !== undefined,
  );
  const decodedBody =
    (preferredPart === undefined ? undefined : bodyData(preferredPart)) ??
    (fallbackPart === undefined ? undefined : bodyData(fallbackPart));

  return {
    ...(typeof message.id === "string" ? { id: message.id } : {}),
    ...(typeof message.internalDate === "string"
      ? { internalDate: message.internalDate }
      : {}),
    headers: selectedHeaders,
    ...(typeof message.snippet === "string" ? { snippet: preview(message.snippet) } : {}),
    ...(decodedBody === undefined
      ? {}
      : { bodyPreview: preview(decodeBase64Url(decodedBody)) }),
  };
}

function bodyData(part: Record<string, unknown>): string | undefined {
  const body = part.body;
  return isRecord(body) ? getString(body, "data") : undefined;
}

function summarizeGmailResponse(path: string, body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    return { kind: typeof body };
  }
  const value = body;
  const threads = getArray(value, "threads");
  if (threads !== undefined) {
    return {
      kind: "thread-list",
      threadCount: threads.length,
      threadIds: threads
        .slice(0, 10)
        .map((thread) =>
          isRecord(thread) ? getString(thread, "id") : undefined,
        )
        .filter((id): id is string => typeof id === "string"),
      ...(typeof value.resultSizeEstimate === "number"
        ? { resultSizeEstimate: value.resultSizeEstimate }
        : {}),
      ...(typeof value.nextPageToken === "string" ? { hasNextPage: true } : {}),
    };
  }
  const messages = getArray(value, "messages");
  if (messages !== undefined) {
    return {
      kind: "thread",
      ...(typeof value.id === "string" ? { threadId: value.id } : {}),
      messageCount: messages.length,
      messageIds: messages
        .slice(0, 10)
        .map((message) =>
          isRecord(message) ? getString(message, "id") : undefined,
        )
        .filter((id): id is string => typeof id === "string"),
    };
  }
  const labels = getArray(value, "labels");
  if (labels !== undefined) {
    return {
      kind: "label-list",
      labelCount: labels.length,
      labelIds: labels
        .slice(0, 20)
        .map((label) =>
          isRecord(label) ? getString(label, "id") : undefined,
        )
        .filter((id): id is string => typeof id === "string"),
    };
  }
  if (typeof value.id === "string") {
    const payload =
      isRecord(value.payload)
        ? value.payload
        : undefined;
    const headers = payload === undefined ? [] : getArray(payload, "headers") ?? [];
    const headerNames =
      headers
          .map((header) =>
            isRecord(header) ? getString(header, "name") : undefined,
          )
          .filter((name): name is string => typeof name === "string");
    return {
      kind: "message",
      messageId: value.id,
      ...(typeof value.threadId === "string" ? { threadId: value.threadId } : {}),
      ...(Array.isArray(value.labelIds) ? { labelIds: value.labelIds } : {}),
      headerNames,
      hasPayloadBody: payload?.body !== undefined || Array.isArray(payload?.parts),
    };
  }
  return { kind: "object", keys: Object.keys(value).slice(0, 20), path };
}

function addContentToSummary(
  summary: Record<string, unknown>,
  body: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) return summary;
  const value = body;

  const threads = getArray(value, "threads");
  if (threads !== undefined) {
    return {
      ...summary,
      threadPreviews: threads.slice(0, 10).flatMap((thread) => {
        if (!isRecord(thread)) return [];
        const item = thread;
        return [
          {
            ...(typeof item.id === "string" ? { id: item.id } : {}),
            ...(typeof item.snippet === "string"
              ? { snippet: preview(item.snippet) }
              : {}),
          },
        ];
      }),
    };
  }

  const messages = getArray(value, "messages");
  if (messages !== undefined) {
    return {
      ...summary,
      messagePreviews: messages
        .slice(0, 10)
        .flatMap((message) =>
          isRecord(message)
            ? [messageContentPreview(message)]
            : [],
        ),
    };
  }

  if (typeof value.id === "string" && value.payload !== undefined) {
    return { ...summary, content: messageContentPreview(value) };
  }

  return summary;
}

export function createStandaloneGmailCredential(
  options: StandaloneGmailCredentialOptions,
): HttpMediatedCredential {
  const networkFetch = options.fetchImpl ?? globalThis.fetch;
  const logger = options.logger ?? defaultGmailLiveLogger;
  let accessToken: GmailAccessToken | undefined;
  let refreshPromise: Promise<GmailAccessToken> | undefined;

  async function getAccessToken(force = false): Promise<string> {
    if (
      !force &&
      accessToken !== undefined &&
      accessToken.expiresAt > Date.now() + 60_000
    ) {
      return accessToken.accessToken;
    }
    refreshPromise ??= refreshGmailAccessToken(
      options.config,
      options.token.refreshToken,
      networkFetch,
    ).finally(() => {
      refreshPromise = undefined;
    });
    accessToken = await refreshPromise;
    return accessToken.accessToken;
  }

  async function authenticatedFetch(
    input: string | URL | Request,
    init?: RequestInit,
    forceRefresh = false,
  ): Promise<Response> {
    const sourceRequest = input instanceof Request ? input : undefined;
    const url = new URL(sourceRequest?.url ?? String(input));
    if (url.origin !== GMAIL_API_ORIGIN) {
      throw new Error(
        `standalone Gmail credential rejected non-Gmail origin: ${url.origin}`,
      );
    }
    const headers = new Headers(sourceRequest?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("Authorization", `Bearer ${await getAccessToken(forceRefresh)}`);

    const startedAt = Date.now();
    const response = await networkFetch(
      new Request(sourceRequest ?? url, {
        ...init,
        headers,
        redirect: "manual",
      }),
    );
    if (options.debug && url.origin === GMAIL_API_ORIGIN) {
      let summary: Record<string, unknown> = { kind: "unreadable" };
      let responseBodyForLogging: unknown;
      try {
        responseBodyForLogging = await response.clone().json();
        summary = summarizeGmailResponse(url.pathname, responseBodyForLogging);
      } catch {
        summary = { kind: "non-json" };
      }
      logger.info(
        `[gmail-live] ${JSON.stringify({
          method: (init?.method ?? sourceRequest?.method ?? "GET").toUpperCase(),
          path: url.pathname,
          status: response.status,
          durationMs: Date.now() - startedAt,
          response: options.showContent
            ? addContentToSummary(summary, responseBodyForLogging)
            : summary,
        })}`,
      );
    }
    return response;
  }

  return {
    kind: "http",
    async fetch(input, init) {
      const response = await authenticatedFetch(input, init);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (response.status !== 401 || !["GET", "HEAD", "OPTIONS"].includes(method)) {
        return response;
      }
      return authenticatedFetch(input, init, true);
    },
    dispose() {
      accessToken = undefined;
    },
  };
}
