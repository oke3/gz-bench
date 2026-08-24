# Contributing to opencode-bench

Thanks for your interest in improving the harness!

## Development setup

Requirements: **Node.js >= 24** (tests use the native `node:test` runner with TypeScript
type-stripping — no transpiler step needed for tests) and npm.

```sh
git clone https://github.com/oke3/opencode-bench.git
cd opencode-bench
npm install
npm test
```

## Before you open a PR

Run the full gate — all three must pass:

```sh
npm run typecheck   # strict tsc over src/ and test/
npm test            # node:test suite (44+ cases)
npm run build       # dist/ must emit cleanly
```

## Guidelines

- **Zero runtime dependencies.** The harness stays dependency-free; devDependencies are
  limited to `typescript` and `@types/node`.
- **Deterministic tests only.** Tests must use temp directories, never touch `$HOME`,
  and never call a network or an LLM.
- **Strict validation errors.** User-facing errors should name the exact JSON path that
  failed (e.g. `invalid suite at cases[0].checks[2].pattern: ...`).
- Keep the public surface small: if something can be a check kind or a CLI flag value,
  it probably shouldn't be new API.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Code of conduct

Be direct, be kind, no drama.
