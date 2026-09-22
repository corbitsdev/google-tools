import { describe, expect, test } from "bun:test";
import { createRuntimeCapabilities } from "@intx/types/runtime-capabilities";

import type { GmailFetch } from "../client/index.js";
import { GMAIL_CREDENTIAL_HANDLE, TOOL_DEFINITIONS } from "./definitions.js";
import { createGmailTools } from "./create-tools.js";
import { createRawDraft } from "./drafts.js";
import { gmail } from "../sidecar-bundle.js";

function testCapabilities(fetchImpl: GmailFetch, handle = GMAIL_CREDENTIAL_HANDLE) {
  return createRuntimeCapabilities({
    credentials: {
      async resolve(requested) {
        if (requested !== handle) {
          throw new Error(`unbound credential handle: ${requested}`);
        }
        return { kind: "http", fetch: fetchImpl, dispose() {} };
      },
    },
  });
}

function createFetchImpl(handler: GmailFetch): GmailFetch {
  return handler;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function jsonRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("expected JSON string body");
  const parsed: unknown = JSON.parse(init.body);
  if (!isRecord(parsed)) {
    throw new Error("expected JSON object body");
  }
  return parsed;
}

function draftRawFromRequest(init: RequestInit | undefined): string {
  const body = jsonRequestBody(init);
  const message = body.message;
  if (!isRecord(message)) {
    throw new Error("expected draft message object");
  }
  if (typeof message.raw !== "string") throw new Error("expected draft raw message");
  return message.raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Gmail tool definitions", () => {
  test("declares the complete Google-compatible Gmail surface", () => {
    expect(TOOL_DEFINITIONS.map((definition) => definition.name).sort()).toEqual([
      "gmail_create_draft",
      "gmail_get_message",
      "gmail_get_thread",
      "gmail_label_message",
      "gmail_label_thread",
      "gmail_list_drafts",
      "gmail_list_labels",
      "gmail_search_threads",
      "gmail_unlabel_message",
      "gmail_unlabel_thread",
    ]);
  });

  test("publishes strict generated JSON Schemas with Google defaults", () => {
    for (const definition of TOOL_DEFINITIONS) {
      expect(definition.inputSchema).toMatchObject({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        additionalProperties: false,
      });
    }
    const searchThreads = TOOL_DEFINITIONS.find(
      (definition) => definition.name === "gmail_search_threads",
    );
    expect(searchThreads?.inputSchema).toMatchObject({
      properties: {
        pageSize: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        includeTrash: { type: "boolean", default: false },
        view: {
          default: "THREAD_VIEW_MINIMAL",
          anyOf: [
            { const: "THREAD_VIEW_METADATA_ONLY" },
            { const: "THREAD_VIEW_MINIMAL" },
          ],
        },
      },
    });
  });

  test("requires approval for every mailbox mutation", () => {
    const approvals = new Map(
      gmail.definitions.map((definition) => [definition.name, definition.approval]),
    );
    for (const name of [
      "gmail_create_draft",
      "gmail_label_message",
      "gmail_unlabel_message",
      "gmail_label_thread",
      "gmail_unlabel_thread",
    ]) {
      expect(approvals.get(name)).toBe("ask");
    }
  });
});

describe("createGmailTools", () => {
  test("searches through the mediated credential with Google-compatible defaults", async () => {
    const fetchImpl = createFetchImpl(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://gmail.googleapis.com");
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      if (url.pathname === "/gmail/v1/users/me/threads") {
        expect(url.searchParams.get("q")).toBe("subject:fixture");
        expect(url.searchParams.get("maxResults")).toBe("20");
        expect(url.searchParams.get("includeSpamTrash")).toBe("false");
        return new Response(
          JSON.stringify({
            threads: [{ id: "thread-1" }],
            nextPageToken: "next-2",
            resultSizeEstimate: 101,
          }),
        );
      }

      expect(url.pathname).toBe("/gmail/v1/users/me/threads/thread-1");
      expect(url.searchParams.get("format")).toBe("metadata");
      expect(url.searchParams.getAll("metadataHeaders")).toEqual([
        "Subject",
        "From",
        "To",
        "Cc",
        "Date",
      ]);
      return new Response(
        JSON.stringify({
          id: "thread-1",
          messages: [
            {
              id: "message-1",
              threadId: "thread-1",
              labelIds: ["INBOX"],
              snippet: "fixture message",
              payload: {
                headers: [
                  { name: "Subject", value: "Fixture" },
                  { name: "From", value: "ada@example.com" },
                  { name: "To", value: "team@example.com" },
                  { name: "Date", value: "Tue, 19 Aug 2026 12:00:00 +0000" },
                ],
              },
            },
          ],
        }),
      );
    });

    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });
    const result = await tools.run(
      {
        id: "call-1",
        name: "gmail_search_threads",
        arguments: { query: "subject:fixture" },
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      callId: "call-1",
      content: {
        data: {
          threads: [
            {
              id: "thread-1",
              messages: [
                {
                  id: "message-1",
                  threadId: "thread-1",
                  labelIds: ["INBOX"],
                  date: "2026-08-19",
                  snippet: "fixture message",
                  subject: "Fixture",
                  sender: "ada@example.com",
                  toRecipients: ["team@example.com"],
                },
              ],
            },
          ],
          nextPageToken: "next-2",
          resultCountEstimate: 101,
        },
      },
    });
    await tools.dispose();
  });

  test("bounds thread lookups while preserving search order", async () => {
    const started: string[] = [];
    const resolveThread = new Map<string, () => void>();
    const fetchImpl = createFetchImpl(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/gmail/v1/users/me/threads") {
        return new Response(
          JSON.stringify({ threads: Array.from({ length: 11 }, (_, index) => ({ id: `thread-${index + 1}` })) }),
        );
      }
      const id = url.pathname.split("/").at(-1);
      if (id === undefined) throw new Error("expected thread ID");
      started.push(id);
      return new Promise((resolve) => {
        resolveThread.set(id, () => resolve(new Response(JSON.stringify({ id, messages: [] }))));
      });
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });
    const resultPromise = tools.run(
      { id: "call-thread-limit", name: "gmail_search_threads", arguments: { pageSize: 11 } },
      new AbortController().signal,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(10);
    expect(resolveThread.has("thread-11")).toBe(false);
    for (const id of [...started].reverse()) {
      const resolve = resolveThread.get(id);
      if (resolve === undefined) throw new Error(`missing thread resolver: ${id}`);
      resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toContain("thread-11");
    const resolve = resolveThread.get("thread-11");
    if (resolve === undefined) throw new Error("missing thread-11 resolver");
    resolve();

    const result = await resultPromise;
    expect(result.content).toMatchObject({
      data: { threads: Array.from({ length: 11 }, (_, index) => ({ id: `thread-${index + 1}` })) },
    });
    await tools.dispose();
  });

  test("does not start queued thread lookups after abort", async () => {
    const started: string[] = [];
    const resolveThread = new Map<string, () => void>();
    const fetchImpl = createFetchImpl(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/gmail/v1/users/me/threads") {
        return new Response(
          JSON.stringify({ threads: Array.from({ length: 11 }, (_, index) => ({ id: `thread-${index + 1}` })) }),
        );
      }
      const id = url.pathname.split("/").at(-1);
      if (id === undefined) throw new Error("expected thread ID");
      started.push(id);
      return new Promise((resolve) => {
        resolveThread.set(id, () => resolve(new Response(JSON.stringify({ id, messages: [] }))));
      });
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });
    const controller = new AbortController();
    const resultPromise = tools.run(
      { id: "call-thread-abort", name: "gmail_search_threads", arguments: { pageSize: 11 } },
      controller.signal,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(10);
    controller.abort();
    for (const id of started) {
      const resolve = resolveThread.get(id);
      if (resolve === undefined) throw new Error(`missing thread resolver: ${id}`);
      resolve();
    }

    const result = await resultPromise;
    expect(result.isError).toBe(true);
    expect(started).not.toContain("thread-11");
    await tools.dispose();
  });

  test("returns complete decoded text, HTML, and attachment metadata", async () => {
    const plaintextBody = "a".repeat(70_000);
    const fetchImpl = createFetchImpl(async (input) => {
      expect(new URL(String(input)).pathname).toBe(
        "/gmail/v1/users/me/messages/message-1",
      );
      return new Response(
        JSON.stringify({
          id: "message-1",
          threadId: "thread-1",
          labelIds: ["INBOX"],
          payload: {
            headers: [
              { name: "Subject", value: "Fixture" },
              { name: "From", value: "ada@example.com" },
              { name: "To", value: "grace@example.com, linus@example.com" },
              { name: "Date", value: "Tue, 19 Aug 2026 12:00:00 +0000" },
            ],
            parts: [
              { mimeType: "text/plain", body: { data: encodeBase64Url(plaintextBody) } },
              { mimeType: "text/html", body: { data: encodeBase64Url("<p>Hello</p>") } },
              {
                mimeType: "application/pdf",
                filename: "report.pdf",
                body: { attachmentId: "attachment-1", data: "not-returned" },
              },
              {
                mimeType: "text/plain",
                filename: "payroll.txt",
                body: {
                  attachmentId: "attachment-2",
                  data: encodeBase64Url("confidential attachment"),
                },
              },
            ],
          },
        }),
      );
    });

    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });
    const result = await tools.run(
      {
        id: "call-2",
        name: "gmail_get_message",
        arguments: { messageId: "message-1" },
      },
      new AbortController().signal,
    );

    expect(result.content).toEqual({
      data: {
        id: "message-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        date: "2026-08-19",
        subject: "Fixture",
        sender: "ada@example.com",
        toRecipients: ["grace@example.com", "linus@example.com"],
        plaintextBody,
        htmlBody: "<p>Hello</p>",
        attachmentIds: ["attachment-1", "attachment-2"],
        attachments: [
          {
            id: "attachment-1",
            mimeType: "application/pdf",
            filename: "report.pdf",
          },
          {
            id: "attachment-2",
            mimeType: "text/plain",
            filename: "payroll.txt",
          },
        ],
      },
    });
    await tools.dispose();
  });

  test("preserves commas inside quoted recipient display names", async () => {
    const fetchImpl = createFetchImpl(async () =>
      new Response(
        JSON.stringify({
          id: "message-1",
          payload: {
            headers: [
              { name: "To", value: '"Doe, John" <doe@example.com>, bob@example.com' },
            ],
          },
        }),
      ),
    );
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });

    const result = await tools.run(
      {
        id: "call-recipient-parser",
        name: "gmail_get_message",
        arguments: { messageId: "message-1", messageFormat: "MINIMAL" },
      },
      new AbortController().signal,
    );

    expect(result.content).toMatchObject({
      data: {
        toRecipients: ['"Doe, John" <doe@example.com>', "bob@example.com"],
      },
    });
    await tools.dispose();
  });

  test("omits message bodies for metadata-only requests", async () => {
    const fetchImpl = createFetchImpl(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("format")).toBe("metadata");
      expect(url.searchParams.getAll("metadataHeaders")).toEqual([]);
      return new Response(
        JSON.stringify({
          id: "message-1",
          threadId: "thread-1",
          labelIds: ["INBOX"],
          internalDate: "1787140800000",
          sizeEstimate: 42,
          payload: {
            headers: [{ name: "Subject", value: "Not exposed" }],
            body: { data: encodeBase64Url("Not exposed") },
          },
        }),
      );
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });

    const result = await tools.run(
      {
        id: "call-3",
        name: "gmail_get_message",
        arguments: { messageId: "message-1", messageFormat: "METADATA_ONLY" },
      },
      new AbortController().signal,
    );

    expect(result.content).toEqual({
      data: {
        id: "message-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        sizeEstimate: 42,
        date: "2026-08-19",
      },
    });
    await tools.dispose();
  });

  test("fails before network access for invalid arguments", async () => {
    const fetchImpl = createFetchImpl(async () => {
      throw new Error("network should not run");
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });

    const result = await tools.run(
      {
        id: "call-4",
        name: "gmail_search_threads",
        arguments: { pageSize: 51 },
      },
      new AbortController().signal,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual({
      error:
        "invalid tool input: pageSize must be Maximum number of threads to return; defaults to 20. (was 51)",
    });
    await tools.dispose();
  });

  test("fails closed when gmail-api is not bound", async () => {
    const tools = createGmailTools({
      capabilities: testCapabilities(
        createFetchImpl(async () => new Response("{}")),
        "other-handle",
      ),
    });
    const result = await tools.run(
      { id: "call-5", name: "gmail_list_labels", arguments: {} },
      new AbortController().signal,
    );
    expect(result.isError).toBe(true);
    if (
      typeof result.content !== "object" ||
      result.content === null ||
      !("error" in result.content)
    ) {
      throw new Error("expected a tool error");
    }
    expect(String(result.content.error)).toContain(GMAIL_CREDENTIAL_HANDLE);
  });

  test("retries credential resolution after a transient failure", async () => {
    let resolveAttempts = 0;
    const fetchImpl = createFetchImpl(async (input) => {
      expect(new URL(String(input)).pathname).toBe("/gmail/v1/users/me/labels");
      return new Response(JSON.stringify({ labels: [] }));
    });
    const tools = createGmailTools({
      capabilities: createRuntimeCapabilities({
        credentials: {
          async resolve(handle) {
            resolveAttempts += 1;
            if (handle !== GMAIL_CREDENTIAL_HANDLE || resolveAttempts === 1) {
              throw new Error("credential temporarily unavailable");
            }
            return { kind: "http", fetch: fetchImpl, dispose() {} };
          },
        },
      }),
    });

    const signal = new AbortController().signal;
    const firstResult = await tools.run(
      { id: "call-retry-1", name: "gmail_list_labels", arguments: {} },
      signal,
    );
    expect(firstResult).toMatchObject({
      content: { error: "credential temporarily unavailable" },
      isError: true,
    });

    const secondResult = await tools.run(
      { id: "call-retry-2", name: "gmail_list_labels", arguments: {} },
      signal,
    );
    expect(secondResult).toEqual({
      callId: "call-retry-2",
      content: { data: { labels: [] } },
    });
    expect(resolveAttempts).toBe(2);
    await tools.dispose();
  });

  test("creates a plain-text draft and returns its normalized Gmail draft", async () => {
    const fetchImpl = createFetchImpl(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/gmail/v1/users/me/drafts");
      expect(init?.method).toBe("POST");
      expect(Buffer.from(draftRawFromRequest(init), "base64url").toString()).toContain(
        "To: ada@example.com\r\nSubject: Status\r\nMIME-Version: 1.0",
      );
      return new Response(JSON.stringify({ id: "draft-1" }));
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });

    const result = await tools.run(
      {
        id: "call-draft",
        name: "gmail_create_draft",
        arguments: { to: ["ada@example.com"], subject: "Status", body: "The body" },
      },
      new AbortController().signal,
    );

    expect(result.content).toEqual({
      data: {
        id: "draft-1",
      },
    });
    await tools.dispose();
  });

  test("keeps display-name recipients that Gmail accepts in raw RFC 5322 drafts", () => {
    const raw = createRawDraft({
      to: ["Ada Lovelace <ada@example.com>"],
      body: "Status",
    });

    expect(Buffer.from(raw, "base64url").toString()).toContain(
      "To: Ada Lovelace <ada@example.com>",
    );
  });

  test("rejects injected reply reference headers", () => {
    expect(() =>
      createRawDraft(
        { body: "Reply" },
        {
          messageId: "<message-1@example.com>",
          references: "<reference@example.com>\r\nBcc: attacker@example.com",
        },
      ),
    ).toThrow('argument "references" cannot contain a newline');
  });

  test("appends the parent message to reply references", () => {
    const raw = createRawDraft(
      { body: "Reply" },
      {
        messageId: "<message-2@example.com>",
        references: "<message-1@example.com>",
      },
    );
    expect(Buffer.from(raw, "base64url").toString()).toContain(
      "References: <message-1@example.com> <message-2@example.com>",
    );
  });

  test("lists drafts, including Gmail-query-filtered drafts", async () => {
    const fetchImpl = createFetchImpl(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/gmail/v1/users/me/drafts") {
        if (url.searchParams.get("maxResults") === "500") {
          return new Response(
            JSON.stringify({ drafts: [{ id: "draft-1", message: { id: "message-1" } }] }),
          );
        }
        expect(url.searchParams.get("maxResults")).toBe("20");
        return new Response(JSON.stringify({ drafts: [{ id: "draft-1" }] }));
      }
      if (url.pathname === "/gmail/v1/users/me/messages") {
        expect(url.searchParams.get("q")).toBe("in:drafts subject:status");
        return new Response(JSON.stringify({ messages: [{ id: "message-1" }] }));
      }
      return new Response(
        JSON.stringify({
          id: "draft-1",
          message: { id: "message-1", payload: { headers: [] } },
        }),
      );
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });

    const result = await tools.run(
      { id: "call-list-drafts", name: "gmail_list_drafts", arguments: {} },
      new AbortController().signal,
    );
    expect(result.content).toEqual({ data: { drafts: [{ id: "draft-1" }] } });

    const queryResult = await tools.run(
      {
        id: "call-list-drafts-query",
        name: "gmail_list_drafts",
        arguments: { query: "subject:status" },
      },
      new AbortController().signal,
    );
    expect(queryResult.content).toEqual({ data: { drafts: [{ id: "draft-1" }] } });
    await tools.dispose();
  });

  test("stops draft query paging after finding the requested drafts", async () => {
    let draftPageRequests = 0;
    const fetchImpl = createFetchImpl(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/gmail/v1/users/me/messages") {
        return new Response(
          JSON.stringify({
            messages: [{ id: "message-2" }, { id: "message-1" }],
            nextPageToken: "query-next",
          }),
        );
      }
      if (url.pathname === "/gmail/v1/users/me/drafts") {
        draftPageRequests += 1;
        return new Response(
          JSON.stringify({
            drafts: [
              { id: "draft-1", message: { id: "message-1" } },
              { id: "draft-2", message: { id: "message-2" } },
            ],
            nextPageToken: "unused-draft-page",
          }),
        );
      }
      const id = url.pathname.split("/").at(-1);
      return new Response(JSON.stringify({ id: `draft-${id?.at(-1)}`, message: { id, payload: { headers: [] } } }));
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });
    const result = await tools.run(
      { id: "call-draft-page", name: "gmail_list_drafts", arguments: { query: "subject:status" } },
      new AbortController().signal,
    );
    expect(draftPageRequests).toBe(1);
    expect(result.content).toMatchObject({
      data: { drafts: [{ id: "draft-2" }, { id: "draft-1" }], nextPageToken: "query-next" },
    });
    await tools.dispose();
  });

  test("continues draft query paging until it finds a requested draft", async () => {
    const fetchImpl = createFetchImpl(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/gmail/v1/users/me/messages") {
        return new Response(JSON.stringify({ messages: [{ id: "message-1" }] }));
      }
      if (url.pathname === "/gmail/v1/users/me/drafts") {
        return new Response(
          url.searchParams.get("pageToken") === null
            ? JSON.stringify({ drafts: [], nextPageToken: "page-2" })
            : JSON.stringify({ drafts: [{ id: "draft-1", message: { id: "message-1" } }] }),
        );
      }
      return new Response(JSON.stringify({ id: "draft-1", message: { id: "message-1", payload: { headers: [] } } }));
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });
    const result = await tools.run(
      { id: "call-draft-page-2", name: "gmail_list_drafts", arguments: { query: "subject:status" } },
      new AbortController().signal,
    );
    expect(result.content).toMatchObject({ data: { drafts: [{ id: "draft-1" }] } });
    await tools.dispose();
  });

  test("uses the original sender when a reply draft omits recipients", () => {
    const raw = createRawDraft(
      { body: "Reply" },
      { messageId: "<message-1@example.com>", subject: "Original", to: ["ada@example.com"] },
    );
    expect(Buffer.from(raw, "base64url").toString()).toContain("To: ada@example.com");
  });

  test("applies and removes labels on messages and threads", async () => {
    const fetchImpl = createFetchImpl(async (input, init) => {
      const url = new URL(String(input));
      const request = jsonRequestBody(init);
      expect(url.pathname).toMatch(/\/(messages|threads)\/(message-1|thread-1)\/modify$/);
      if (url.pathname.includes("threads")) {
        return new Response(JSON.stringify({ id: "thread-1", messages: [] }));
      }
      return new Response(
        JSON.stringify({
          id: "message-1",
          labelIds: request.addLabelIds ?? request.removeLabelIds,
        }),
      );
    });
    const tools = createGmailTools({ capabilities: testCapabilities(fetchImpl) });
    const signal = new AbortController().signal;

    for (const name of [
      "gmail_label_message",
      "gmail_unlabel_message",
      "gmail_label_thread",
      "gmail_unlabel_thread",
    ]) {
      const isThread = name.endsWith("thread");
      const result = await tools.run(
        {
          id: name,
          name,
          arguments: { [isThread ? "threadId" : "messageId"]: isThread ? "thread-1" : "message-1", labelIds: ["STARRED"] },
        },
        signal,
      );
      expect(result.isError).not.toBe(true);
    }
    await tools.dispose();
  });
});
