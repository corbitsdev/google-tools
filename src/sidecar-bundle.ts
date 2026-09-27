// Sidecar-bundle entry for `@corbits/google-tools` — the convention-compliant
// factory the tool-package loader invokes.
//
// The bundle consumes the host-assembled runtime capabilities rather than
// building its own. The host (the sidecar's step-env builder) owns the
// `RuntimeCapabilities` and puts it on `env.capabilities`; this factory
// resolves the `gmail-api` credential from it through `createGmailTools`. The
// env key it touches (`capabilities`) is declared in `requires`.

import { defineTool, type BaseEnv } from "@intx/agent";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";

import { createGmailTools } from "./tools/create-tools.js";
import { GMAIL_TOOL_CATALOG } from "./tools/definitions.js";

/**
 * Env contract for the Gmail tool bundle. Extends `BaseEnv` with the
 * host-assembled `capabilities`, from which the Gmail tools resolve the
 * `gmail-api` credential.
 */
export interface GmailToolEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

/**
 * Named export the loader picks up. The id is package-namespaced per
 * the convention; the model-facing tool names are synthesized by the
 * loader as `@corbits/google-tools/sidecar-bundle:<def.name>`.
 */
export const gmail = defineTool<GmailToolEnv>({
  id: "@corbits/google-tools/sidecar-bundle",
  requires: ["capabilities"],
  // Unlike tools-mail, every tool declares approval: Gmail is third-party
  // data, so each tool asks until a person saves an allow grant.
  definitions: GMAIL_TOOL_CATALOG.map((def) => ({
    name: def.name,
    approval: def.approval,
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
