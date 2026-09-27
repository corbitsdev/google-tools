# @corbits/google-tools

Gmail tools for AI agents: search, read, label and draft over the Gmail REST API, authenticated by an HTTP credential that signs each request so the agent never holds an OAuth token. A tool pack for the Interchange sidecar that also runs standalone.

## Why @corbits/google-tools?

1. **No tokens in the agent.** Tools call Gmail through a credential the host resolves at run time. The OAuth token never enters the model context or tool arguments.
2. **Human approval on every tool.** Every tool uses `approval: "ask"`, so Interchange pauses each call until a person approves it or saves an always-allow grant. No tool can send mail.
3. **Grant-gated in Interchange.** The package declares the `gmail-api` credential and the `gmail.modify` scope it needs. The hub (Interchange's control plane) stores the credential, and a grant (a record of which agent may use it) decides which agents get it.

It covers Gmail only, not other Google APIs.

## Install

```bash
bun add @corbits/google-tools @intx/agent @intx/types
```

Requires Node.js 24 or newer.

## Quickstart

Gives an Interchange agent the Gmail tools:

```ts
import { defineAgent } from "@intx/agent";
import { gmail } from "@corbits/google-tools/sidecar-bundle";

export const inboxAgent = defineAgent({
  id: "inbox-agent",
  systemPrompt: "Triage my Gmail inbox and draft replies for me to review.",
  tools: [gmail],
  capabilities: [],
  inference: { sources: [{ provider: "ollama", model: "gpt-oss:20b" }] },
});
```

When the agent runs, the sidecar resolves the `gmail-api` credential the hub
granted it and passes it to the tools. The token stays out of the agent.

## Where it fits

[Interchange](https://github.com/faremeter/interchange) runs AI agents as principals (accounts that hold their own identity, permissions and credentials).

- Runs in the sidecar, the runtime that hosts each agent and its tools.
- Registers its tools with `defineTool` from
  [`@intx/agent`](https://github.com/faremeter/interchange/tree/main/packages/agent).
- Reads the Gmail credential from the runtime capabilities in
  [`@intx/types`](https://github.com/faremeter/interchange/tree/main/packages/types).
- Pairs with
  [`@corbits/oauth-core`](https://github.com/corbitsdev/corbits-oauth-core),
  which obtains the Google credential the hub stores.

## Reference

| Tool                    | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `gmail_search_threads`  | Search the mailbox and return thread summaries.     |
| `gmail_get_thread`      | Fetch one thread with selected message detail.      |
| `gmail_get_message`     | Fetch one message with selected detail.             |
| `gmail_list_labels`     | List the mailbox labels.                            |
| `gmail_create_draft`    | Create a draft, optionally as a reply. Never sends. |
| `gmail_list_drafts`     | List drafts with Gmail-query filtering.             |
| `gmail_label_message`   | Add labels to a message.                            |
| `gmail_unlabel_message` | Remove labels from a message.                       |
| `gmail_label_thread`    | Add labels to every message in a thread.            |
| `gmail_unlabel_thread`  | Remove labels from every message in a thread.       |

### Approvals

Every tool declares `approval: "ask"`, including the read-only ones, because
Gmail is third-party data. Interchange pauses each call until a person
responds. Allowing once runs that call; always allowing saves an `allow`
grant for that tool on that agent, so later calls run without asking.

## Using with Interchange

The sidecar loads tools from the `./sidecar-bundle` export. Its `gmail` export
builds the tools from the `capabilities` the sidecar puts in the agent's
environment.

The package's `package.json` tells Interchange what to load:

- `interchange.tools` points at `./dist/sidecar-bundle.js`.
- `interchange.credentials` asks for a credential named `gmail-api` with the
  `https://www.googleapis.com/auth/gmail.modify` scope.

To connect it, store the user's Google OAuth credential on the hub as
`gmail-api` and grant it to the agent. The sidecar resolves it for the tools at
run time.

## License

LGPL-2.1-only. See
[LICENSE](https://github.com/corbitsdev/google-tools/blob/main/LICENSE).
Development notes are in [CONTRIBUTING.md](https://github.com/corbitsdev/google-tools/blob/main/CONTRIBUTING.md).
