import { describe, expect, test } from "bun:test";

import {
  createGmailClient,
  GmailApiError,
  GMAIL_API_BASE_URL,
  type GmailFetch,
} from "./client.js";

describe("createGmailClient", () => {
  test("lists threads through the Gmail API without adding authorization", async () => {
    const fetchImpl: GmailFetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(`${GMAIL_API_BASE_URL}/threads`);
      expect(url.searchParams.get("q")).toBe("from:ada@example.com");
      expect(url.searchParams.get("maxResults")).toBe("10");
      expect(url.searchParams.get("pageToken")).toBe("next-1");
      expect(url.searchParams.get("includeSpamTrash")).toBe("true");
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      expect(new Headers(init?.headers).get("User-Agent")).toBeNull();
      return new Response(
        JSON.stringify({
          threads: [{ id: "thread-1", futureThreadField: true }],
          futureEnvelopeField: { accepted: true },
        }),
        { status: 200 },
      );
    };

    const client = createGmailClient({ fetchImpl });
    await expect(
      client.listThreads({
        query: "from:ada@example.com",
        pageSize: 10,
        pageToken: "next-1",
        includeTrash: true,
      }),
    ).resolves.toMatchObject({ threads: [{ id: "thread-1" }] });
  });

  test("encodes message IDs and selects the requested format", async () => {
    const fetchImpl: GmailFetch = async (input) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        `${GMAIL_API_BASE_URL}/messages/message%2F1`,
      );
      expect(url.searchParams.get("format")).toBe("metadata");
      return new Response(JSON.stringify({ id: "message/1" }), { status: 200 });
    };

    const client = createGmailClient({ fetchImpl });
    await expect(
      client.getMessage("message/1", { format: "metadata", metadataHeaders: [] }),
    ).resolves.toEqual({ id: "message/1" });
  });

  test("rejects malformed successful Gmail responses", async () => {
    const fetchImpl: GmailFetch = async () =>
      new Response(JSON.stringify({ messages: [{ threadId: "thread-1" }] }), {
        status: 200,
      });
    const client = createGmailClient({ fetchImpl });

    await expect(
      client.listMessages({ query: "in:inbox", pageSize: 10 }),
    ).rejects.toThrow("Gmail API response did not match the expected list-messages shape");
  });

  test("rejects malformed Gmail headers", async () => {
    const fetchImpl: GmailFetch = async () =>
      new Response(
        JSON.stringify({
          id: "message-1",
          payload: { headers: [{ name: "Subject", value: 42 }] },
        }),
        { status: 200 },
      );
    const client = createGmailClient({ fetchImpl });

    await expect(
      client.getMessage("message-1", { format: "full" }),
    ).rejects.toThrow("Gmail API response did not match the expected get-message shape");
  });

  test("rejects an empty successful response body", async () => {
    const fetchImpl: GmailFetch = async () => new Response("", { status: 200 });
    const client = createGmailClient({ fetchImpl });

    await expect(client.listLabels()).rejects.toThrow("response body was empty");
  });

  test("maps non-success responses to GmailApiError", async () => {
    const fetchImpl: GmailFetch = async () =>
      new Response('{"error":{"message":"forbidden"}}', {
        status: 403,
        statusText: "Forbidden",
      });
    const client = createGmailClient({ fetchImpl });

    try {
      await client.listLabels();
      throw new Error("Expected listLabels to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GmailApiError);
      if (!(error instanceof GmailApiError)) throw error;
      expect(error.status).toBe(403);
      expect(error.body).toContain("forbidden");
    }
  });

  test("preserves the complete Gmail error response body", async () => {
    const body = "x".repeat(2_001);
    const fetchImpl: GmailFetch = async () =>
      new Response(body, { status: 400, statusText: "Bad Request" });
    const client = createGmailClient({ fetchImpl });

    try {
      await client.listLabels();
      throw new Error("Expected listLabels to throw");
    } catch (error) {
      if (!(error instanceof GmailApiError)) throw error;
      expect(error.body).toBe(body);
    }
  });
});
