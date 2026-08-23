import { defineTool, type BaseEnv } from "@intx/agent";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";

import { createGmailTools } from "./tools/create-tools.js";
import { TOOL_DEFINITIONS } from "./tools/definitions.js";

const MUTATING_TOOL_NAMES = new Set([
  "gmail_create_draft",
  "gmail_label_message",
  "gmail_unlabel_message",
  "gmail_label_thread",
  "gmail_unlabel_thread",
]);
const MUTATING_TOOL_APPROVAL: "ask" = "ask";

export interface GmailToolEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

export const gmail = defineTool<GmailToolEnv>({
  id: "@corbits/google-tools/sidecar-bundle",
  requires: ["capabilities"],
  definitions: TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    ...(MUTATING_TOOL_NAMES.has(definition.name)
      ? { approval: MUTATING_TOOL_APPROVAL }
      : {}),
  })),
  factory: (env) => {
    const tools = createGmailTools({ capabilities: env.capabilities });
    return {
      definitions: tools.definitions,
      run: (call, signal) => tools.run(call, signal),
      dispose: () => tools.dispose(),
    };
  },
});
