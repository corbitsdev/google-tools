import { expect, test } from "bun:test";

import type { GmailTools } from "../../src/tools/create-tools.js";
import { findGmailFixture } from "./fixtures.js";

test("findGmailFixture uses the Gmail tool argument contract", async () => {
  let call:
    | { id: string; name: string; arguments: Record<string, unknown> }
    | undefined;
  const tools: GmailTools = {
    definitions: [],
    async dispose() {},
    async run(toolCall) {
      call = toolCall;
      return {
        callId: toolCall.id,
        content: {
          data: {
            threads: [{ id: "thread-1", messages: [{ id: "message-1" }] }],
          },
        },
      };
    },
  };

  await expect(
    findGmailFixture(tools, "subject:(interchange-gmail-e2e-fixture)", new AbortController().signal),
  ).resolves.toEqual({ threadId: "thread-1", messageId: "message-1" });
  expect(call).toEqual({
    id: "live-fixture-search",
    name: "gmail_search_threads",
    arguments: { query: "subject:(interchange-gmail-e2e-fixture)", pageSize: 10 },
  });
});

test("findGmailFixture rejects ambiguous thread matches", async () => {
  const tools: GmailTools = {
    definitions: [],
    async dispose() {},
    async run() {
      return {
        callId: "fixture-search",
        content: {
          data: {
            threads: [
              { id: "thread-1", messages: [{ id: "message-1" }] },
              { id: "thread-2", messages: [{ id: "message-2" }] },
            ],
          },
        },
      };
    },
  };

  await expect(
    findGmailFixture(tools, "subject:ambiguous", new AbortController().signal),
  ).rejects.toThrow("exactly one Gmail thread");
});
