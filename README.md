# @corbits/google-tools

Google API clients, starting with Gmail. The Gmail client accepts an injected
`fetch` implementation and never adds authorization headers itself.

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

## License

LGPL-2.1-only. See [LICENSE](./LICENSE).
