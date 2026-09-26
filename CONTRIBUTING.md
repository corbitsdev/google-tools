# Contributing

## Development

```sh
bun install
bun run check
```

`bun run check` runs typecheck, lint, format check and unit tests. `bun run format` rewrites the tree.

Contributors sign the [CLA](CLA.md) on their first PR; the CLA bot explains how.

Unit tests inject `fetch` and never call Gmail. `bun run test:e2e` runs the live
suite, which skips unless `GMAIL_LIVE_TEST=1`.

## Live Gmail checks

Use a dedicated Gmail fixture account and a Desktop OAuth client granted only
`gmail.modify`. The fixture query must match exactly one one-message thread:

```sh
GMAIL_LIVE_TEST=1 \
GMAIL_LIVE_CLIENT_ID='...' \
GMAIL_LIVE_CLIENT_SECRET='...' \
GMAIL_LIVE_FIXTURE_QUERY='subject:(interchange-gmail-e2e-fixture)' \
bun run test:e2e
```

Add `GMAIL_LIVE_MUTATION_TEST=1` for the draft and label checks; the suite
deletes its draft, restores the fixture labels and never sends email. The first
run opens Google OAuth and stores the refresh token in the ignored
`.local/gmail-live-token.json` (override with `GMAIL_LIVE_TOKEN_FILE`).

## Commit messages

Commit subjects and PR titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `perf`, and `chore(release): x.y.z` for releases.
Add `!` only for public API breaks: removed or renamed exports, changed signatures, newly required params. Peer and dependency range changes are `build(deps):` with no `!`.
Keep subjects imperative, lowercase after the colon, 72 characters or less, and free of ticket IDs.
Every PR links its issue with a `Closes <issue id>` line in the PR body.

## Releasing

Releases are manual. On a clean, up-to-date `main`:

```sh
npm version <patch|minor> -m "chore(release): %s"
git push --follow-tags
gh release create "v$(node -p 'require("./package.json").version')" --generate-notes
npm publish
```

Bump minor only for breaking API changes; everything else is a patch. `prepack` builds `dist/` from the tagged commit.
