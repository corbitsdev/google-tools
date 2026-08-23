import type { GmailTools } from "../../src/tools/create-tools.js";
import { getArray, getString, isRecord } from "./json.js";

export type GmailFixture = { threadId: string; messageId: string };

export async function findGmailFixture(
  tools: GmailTools,
  query: string,
  signal: AbortSignal,
): Promise<GmailFixture> {
  const result = await tools.run(
    {
      id: "live-fixture-search",
      name: "gmail_search_threads",
      arguments: { query, pageSize: 10 },
    },
    signal,
  );
  if (result.isError) {
    throw new Error(`fixture search failed: ${JSON.stringify(result.content)}`);
  }
  if (!isRecord(result.content) || !isRecord(result.content.data)) {
    throw new Error("fixture search did not return structured data");
  }
  const threads = getArray(result.content.data, "threads");
  if (threads === undefined || threads.length !== 1) {
    throw new Error(`fixture query must match exactly one Gmail thread: ${query}`);
  }
  const thread = threads[0];
  if (!isRecord(thread)) {
    throw new Error(`no Gmail fixture matched query: ${query}`);
  }
  const threadId = getString(thread, "id");
  const messages = getArray(thread, "messages");
  if (messages === undefined || messages.length !== 1) {
    throw new Error(`fixture thread must contain exactly one Gmail message: ${query}`);
  }
  const firstMessage = messages[0];
  const messageId = isRecord(firstMessage) ? getString(firstMessage, "id") : undefined;
  if (
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof messageId !== "string" ||
    messageId.length === 0
  ) {
    throw new Error(`no Gmail fixture matched query: ${query}`);
  }
  return { threadId, messageId };
}
