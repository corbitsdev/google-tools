# @corbits/google-tools

Google API clients and Interchange tools, starting with Gmail. Authentication
is supplied through the Interchange `gmail-api` mediated credential; the
package never accepts or returns raw tokens.

## Install

```bash
bun add github:corbitsdev/google-tools
```

## Working on it

```bash
bun install
bun run typecheck
bun test
bun run build
```

The tests inject `fetch` implementations and do not call Gmail.

## Live Gmail checks

Use a dedicated Gmail fixture account and a Desktop OAuth client granted only
`gmail.modify`. The read smoke requires a query that matches exactly one
one-message thread:

```bash
GMAIL_LIVE_TEST=1 \
GMAIL_LIVE_CLIENT_ID='...' \
GMAIL_LIVE_CLIENT_SECRET='...' \
GMAIL_LIVE_FIXTURE_QUERY='subject:(interchange-gmail-e2e-fixture)' \
bun run test:live
```

Add `GMAIL_LIVE_MUTATION_TEST=1` to also test draft creation and label changes.
The mutation suite deletes its draft and restores the fixture labels. It never
sends email.

The first run opens Google OAuth and stores the refresh token in the ignored
`.local/gmail-live-token.json` file. Set `GMAIL_LIVE_TOKEN_FILE` when using a
different token file. Credentials and message contents are not logged.

## License

LGPL-2.1-only. See [LICENSE](./LICENSE).
