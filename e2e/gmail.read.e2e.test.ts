import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createLiveHarness, toolData, toolId } from "./helpers.js";

const LIVE_TEST_TIMEOUT_MS = 60_000;

if (process.env.GMAIL_LIVE_TEST !== "1") {
  test.skip("standalone Gmail E2E requires GMAIL_LIVE_TEST=1", () => {});
} else {
  describe("standalone Gmail read smoke", () => {
    let harness: Awaited<ReturnType<typeof createLiveHarness>>;

    beforeAll(async () => {
      harness = await createLiveHarness();
    }, 300_000);

    afterAll(async () => {
      await harness?.dispose();
    });

    test(
      "reads the named fixture through every read tool",
      async () => {
        const signal = new AbortController().signal;
        const threadResult = await harness.tools.run(
          {
            id: "live-thread-read",
            name: "gmail_get_thread",
            arguments: { threadId: harness.fixture.threadId },
          },
          signal,
        );
        expect(toolId(threadResult, "gmail_get_thread")).toBe(
          harness.fixture.threadId,
        );

        const messageResult = await harness.tools.run(
          {
            id: "live-message-read",
            name: "gmail_get_message",
            arguments: {
              messageId: harness.fixture.messageId,
              messageFormat: "METADATA_ONLY",
            },
          },
          signal,
        );
        expect(toolId(messageResult, "gmail_get_message")).toBe(
          harness.fixture.messageId,
        );

        const labelsResult = await harness.tools.run(
          { id: "live-label-list", name: "gmail_list_labels", arguments: {} },
          signal,
        );
        const labels = toolData(labelsResult, "gmail_list_labels").labels;
        expect(Array.isArray(labels)).toBe(true);
      },
      LIVE_TEST_TIMEOUT_MS,
    );
  });
}
