# Contributing

## Development

```bash
bun install
bun run typecheck
bun run typecheck:live
bun run test
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

The full live suite has been verified against a dedicated Gmail fixture account.
It exercises every Gmail tool:

- `gmail_search_threads` finds the one-message fixture thread.
- `gmail_get_thread` and `gmail_get_message` retrieve its metadata.
- `gmail_list_labels` lists the account labels.
- `gmail_create_draft` and `gmail_list_drafts` create and find a disposable
  draft, which the suite then deletes.
- `gmail_label_message` and `gmail_unlabel_message` add and remove `STARRED`
  on the fixture message.
- `gmail_label_thread` and `gmail_unlabel_thread` add and remove `STARRED`
  on every message in the fixture thread.

Add `GMAIL_LIVE_MUTATION_TEST=1` to run the draft and label checks. The suite
deletes its draft, restores the fixture labels, and never sends email.

The first run opens Google OAuth and stores the refresh token in the ignored
`.local/gmail-live-token.json` file. Set `GMAIL_LIVE_TOKEN_FILE` when using a
different token file. Credentials and message contents are not logged.
