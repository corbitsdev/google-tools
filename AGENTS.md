# AGENTS.md

## Purpose

`@corbits/google-tools` is a Gmail tool pack for Interchange agents: search,
read, label and draft over the Gmail REST API. It owns the tool definitions,
input schemas, the Gmail client and the sidecar-bundle entry. It does not own
OAuth or token storage; the host resolves the `gmail-api` credential and signs
each request. It never sends mail.

## Layout

- `src/client/client.ts`: `createGmailClient`, the typed Gmail REST calls.
- `src/client/schemas.ts`: arktype schemas for Gmail responses.
- `src/client/errors.ts`: `GmailApiError`.
- `src/tools/definitions.ts`: the tool catalog, credential handle and scopes.
- `src/tools/schemas.ts`: tool input schemas.
- `src/tools/create-tools.ts`: `createGmailTools`, one handler per tool.
- `src/tools/models.ts`: Gmail message and thread views returned to the model.
- `src/tools/drafts.ts`: RFC 822 draft building.
- `src/sidecar-bundle.ts`: the `./sidecar-bundle` entry the tool-package
  loader invokes.
- `src/index.ts`: the root entry.
- `e2e/`: live Gmail suites, gated on `GMAIL_LIVE_TEST=1`.

## Rules

- Every tool declares `approval: "ask"`, including read-only ones.
- No tool sends mail.
- Tokens never enter tool arguments or results; requests go through the
  host-resolved credential.
- Parse every Gmail response with arktype; never `as T` untrusted input.
- Declare tool definitions and approvals as explicit literals.
- `exactOptionalPropertyTypes` is on: build results with the key omitted,
  not set to `undefined`.

## Local development

```sh
bun install
bun run check
```
