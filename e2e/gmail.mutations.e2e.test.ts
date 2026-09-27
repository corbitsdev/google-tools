import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createLiveHarness,
  getArray,
  getString,
  isRecord,
  toolData,
} from "./helpers.js";

const LIVE_TEST_TIMEOUT_MS = 60_000;
const mutationEnabled =
  process.env.GMAIL_LIVE_TEST === "1" && process.env.GMAIL_LIVE_MUTATION_TEST === "1";

if (!mutationEnabled) {
  test.skip("Gmail mutations require GMAIL_LIVE_TEST=1 and GMAIL_LIVE_MUTATION_TEST=1", () => {});
} else {
  describe("standalone Gmail mutations", () => {
    let harness: Awaited<ReturnType<typeof createLiveHarness>>;
    const draftSubjects = new Set<string>();

    beforeAll(async () => {
      harness = await createLiveHarness();
    }, 300_000);

    afterAll(async () => {
      try {
        for (const subject of draftSubjects) {
          await harness.deleteDraftsForSubject(subject);
        }
      } finally {
        await harness?.dispose();
      }
    });

    test("creates and cleans up a draft, then restores fixture labels", async () => {
      const signal = new AbortController().signal;
      const run = (name: string, arguments_: Record<string, unknown>) =>
        harness.tools.run(
          { id: `live-${name}`, name, arguments: arguments_ },
          signal,
        );
      const subject = `interchange-gmail-live-${crypto.randomUUID()}`;
      draftSubjects.add(subject);

      const draftResult = await run("gmail_create_draft", {
        subject,
        body: "Standalone Gmail live-test draft.",
      });
      const draftId = getString(toolData(draftResult, "gmail_create_draft"), "id");
      if (draftId === undefined) throw new Error("gmail_create_draft did not return an ID");

      const listDraftsResult = await run("gmail_list_drafts", {
        query: `subject:${subject}`,
      });
      const drafts = getArray(toolData(listDraftsResult, "gmail_list_drafts"), "drafts") ?? [];
      expect(
        drafts.some(
          (draft) => isRecord(draft) && getString(draft, "id") === draftId,
        ),
      ).toBe(true);

      const originalMessage = await run("gmail_get_message", {
        messageId: harness.fixture.messageId,
        messageFormat: "METADATA_ONLY",
      });
      const messageWasStarred = (getArray(
        toolData(originalMessage, "gmail_get_message"),
        "labelIds",
      ) ?? []).includes("STARRED");

      const originalThread = await run("gmail_get_thread", {
        threadId: harness.fixture.threadId,
        messageFormat: "METADATA_ONLY",
      });
      const originalMessages = getArray(
        toolData(originalThread, "gmail_get_thread"),
        "messages",
      ) ?? [];
      const originalMessageData = originalMessages[0];
      const threadWasStarred =
        isRecord(originalMessageData) &&
        (getArray(originalMessageData, "labelIds") ?? []).includes("STARRED");

      try {
        const labelMessage = await run("gmail_label_message", {
          messageId: harness.fixture.messageId,
          labelIds: ["STARRED"],
        });
        expect(
          (getArray(toolData(labelMessage, "gmail_label_message"), "labelIds") ?? []).includes(
            "STARRED",
          ),
        ).toBe(true);

        const unlabelMessage = await run("gmail_unlabel_message", {
          messageId: harness.fixture.messageId,
          labelIds: ["STARRED"],
        });
        expect(
          (getArray(toolData(unlabelMessage, "gmail_unlabel_message"), "labelIds") ?? []).includes(
            "STARRED",
          ),
        ).toBe(false);

        const labelThread = await run("gmail_label_thread", {
          threadId: harness.fixture.threadId,
          labelIds: ["STARRED"],
        });
        expect(
          (getArray(toolData(labelThread, "gmail_label_thread"), "messages") ?? []).every(
            (message) =>
              isRecord(message) &&
              (getArray(message, "labelIds") ?? []).includes("STARRED"),
          ),
        ).toBe(true);

        const unlabelThread = await run("gmail_unlabel_thread", {
          threadId: harness.fixture.threadId,
          labelIds: ["STARRED"],
        });
        expect(
          (getArray(toolData(unlabelThread, "gmail_unlabel_thread"), "messages") ?? []).every(
            (message) =>
              !isRecord(message) ||
              !(getArray(message, "labelIds") ?? []).includes("STARRED"),
          ),
        ).toBe(true);
      } finally {
        try {
          await run(
            messageWasStarred ? "gmail_label_message" : "gmail_unlabel_message",
            { messageId: harness.fixture.messageId, labelIds: ["STARRED"] },
          );
        } finally {
          await run(
            threadWasStarred ? "gmail_label_thread" : "gmail_unlabel_thread",
            { threadId: harness.fixture.threadId, labelIds: ["STARRED"] },
          );
        }
      }
    }, LIVE_TEST_TIMEOUT_MS);
  });
}
