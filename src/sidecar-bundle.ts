import { defineTool, type BaseEnv } from "@intx/agent";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";

import { createGmailTools } from "./tools/create-tools.js";
import { GMAIL_TOOL_CATALOG } from "./tools/definitions.js";

export interface GmailToolEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

export const gmail = defineTool<GmailToolEnv>({
  id: "@corbits/google-tools/sidecar-bundle",
  requires: ["capabilities"],
  definitions: GMAIL_TOOL_CATALOG.map((definition) => ({
    name: definition.name,
    ...(definition.approval === undefined ? {} : { approval: definition.approval }),
  })),
  factory: (env) => createGmailTools({ capabilities: env.capabilities }),
});
