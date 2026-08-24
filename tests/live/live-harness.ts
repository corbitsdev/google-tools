import { createRuntimeCapabilities } from "@intx/types/runtime-capabilities";

import { createGmailTools, type GmailTools } from "../../src/tools/create-tools.js";
import {
  createStandaloneGmailCredential,
  GMAIL_API_ORIGIN,
} from "./credential.js";
import { findGmailFixture, type GmailFixture } from "./fixtures.js";
import { authorizeGmail, readGmailOAuthConfig } from "./oauth.js";
import { getArray, getString, isRecord } from "./json.js";
import { createFileTokenStore } from "./token-store.js";

export type LiveHarness = {
  tools: GmailTools;
  fixture: GmailFixture;
  deleteDraftsForSubject(subject: string): Promise<void>;
  dispose(): Promise<void>;
};

export async function createLiveHarness(): Promise<LiveHarness> {
  const config = readGmailOAuthConfig();
  const tokenStore = createFileTokenStore(config.tokenFile);
  const existingToken = await tokenStore.read();
  const token = existingToken ?? (await authorizeGmail(config));
  if (!token.grantedScopes?.includes(config.scopes[0] ?? "")) {
    throw new Error("Gmail OAuth token did not record granted scopes");
  }
  if (existingToken === undefined) await tokenStore.write(token);

  const credential = createStandaloneGmailCredential({
    config,
    token,
  });
  const tools = createGmailTools({
    capabilities: createRuntimeCapabilities({
      credentials: {
        async resolve(handle) {
          if (handle !== "gmail-api") {
            throw new Error(`unknown standalone credential handle: ${handle}`);
          }
          return credential;
        },
      },
    }),
  });

  const query = process.env.GMAIL_LIVE_FIXTURE_QUERY?.trim();
  if (query === undefined || query.length === 0) {
    await tools.dispose();
    throw new Error("GMAIL_LIVE_FIXTURE_QUERY is required for the live Gmail suite");
  }

  try {
    const fixture = await findGmailFixture(tools, query, new AbortController().signal);
    return {
      tools,
      fixture,
      deleteDraftsForSubject: (subject) => deleteDraftsForSubject(tools, credential, subject),
      async dispose() {
        await tools.dispose();
      },
    };
  } catch (cause) {
    await tools.dispose();
    throw cause;
  }
}

async function deleteDraftsForSubject(
  tools: GmailTools,
  credential: { fetch(input: string, init?: RequestInit): Promise<Response> },
  subject: string,
): Promise<void> {
  const result = await tools.run(
    {
      id: "live-cleanup-drafts",
      name: "gmail_list_drafts",
      arguments: { query: `subject:${subject}` },
    },
    new AbortController().signal,
  );
  const data = toolData(result, "gmail_list_drafts");
  const drafts = getArray(data, "drafts") ?? [];
  const draftIds = drafts.flatMap((draft) => {
    if (!isRecord(draft) || getString(draft, "subject") !== subject) return [];
    const id = getString(draft, "id");
    return id === undefined ? [] : [id];
  });
  for (const draftId of draftIds) {
    const response = await credential.fetch(
      `${GMAIL_API_ORIGIN}/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(`failed to delete live test draft: HTTP ${String(response.status)}`);
    }
  }
}

export function toolData(result: unknown, toolName: string): Record<string, unknown> {
  if (!isRecord(result) || result.isError === true || !isRecord(result.content)) {
    throw new Error(`${toolName} failed`);
  }
  const data = result.content.data;
  if (!isRecord(data)) throw new Error(`${toolName} did not return structured data`);
  return data;
}

export function toolId(result: unknown, toolName: string): string {
  const id = getString(toolData(result, toolName), "id");
  if (id === undefined || id.length === 0) throw new Error(`${toolName} did not return an ID`);
  return id;
}
