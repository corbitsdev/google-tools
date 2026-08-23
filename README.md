# @corbits/google-tools

Google API clients and Interchange tools, starting with Gmail. Authentication
is supplied through the Interchange `gmail-api` mediated credential; the
package never accepts or returns raw tokens.

## Install

```bash
bun add github:corbitsdev/google-tools
```

## Working on it

Use a sibling Interchange checkout at `../interchange` to run the tool tests.

```bash
bun install
bun run link:intx
bun run typecheck
bun test
bun run build
```

The tests inject `fetch` implementations and do not call Gmail.

## License

LGPL-2.1-only. See [LICENSE](./LICENSE).
