# gz-bench

> Built by [Ground Zero LLC](https://github.com/oke3) — AI infrastructure for the agentic age.

[![CI](https://github.com/oke3/gz-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/oke3/gz-bench/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@ground-zero-llc/gz-bench.svg)](https://www.npmjs.com/package/@ground-zero-llc/gz-bench)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/@ground-zero-llc/gz-bench.svg)](package.json)

A standardized benchmark harness for AI coding-agent skills. You describe test cases in a declarative
JSON suite; the harness runs each case in an isolated temp workspace using your command template
(e.g. invoking an agent CLI with the case prompt), then scores deterministic filesystem and command
assertions. It never calls any LLM or API itself - you bring the agent, gz-bench brings the
methodology.

## Contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Suite JSON schema](#suite-json-schema)
- [CLI](#cli)
- [Check kinds](#check-kinds)
- [Report format](#report-format)
- [CI integration](#ci-integration)
- [Security](#security)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Why

Benchmarking coding agents is usually ad hoc: hand-rolled scripts, shared state between runs,
non-reproducible workspaces, and no structured results. gz-bench fixes the harness layer:

- **Declarative suites** - cases are plain JSON, reviewable and diffable.
- **Isolation** - every case runs in its own fresh temp workspace (`os.tmpdir()`), so cases cannot
  interfere with each other or with your machine.
- **Deterministic scoring** - checks are pure filesystem/command assertions, not LLM judgments.
- **Structured output** - human table or machine-readable `--json` report for CI pipelines.

## Install

Requires Node.js >= 18.

```sh
npm install -g @ground-zero-llc/gz-bench
```

Or run from a checkout:

```sh
npm install && npm run build && node dist/cli.js --help
```

## Quick start

```sh
gz-bench init ./my-bench
cd my-bench
# sanity check the harness itself:
gz-bench run example-suite.json --cmd "echo done"
# then point --cmd at your agent:
gz-bench run example-suite.json --cmd "my-agent --workdir {{dir}} \"{{prompt}}\""
```

The command template is executed with the system shell in the case workspace. Placeholders:

| Placeholder  | Replaced with                    |
| ------------ | -------------------------------- |
| `{{prompt}}` | the case prompt (all occurrences) |
| `{{dir}}`    | absolute path of the case workspace |

## Suite JSON schema

```jsonc
{
  "name": "my-suite",              // required, non-empty string
  "description": "optional",       // optional string
  "version": "1.0.0",              // optional string
  "cases": [
    {
      "id": "write-hello",         // required, unique within suite
      "prompt": "Create hello.txt containing 'hi'",
      "setup": [                   // optional shell commands, run before the agent
        "npm install"
      ],
      "timeoutSec": 120,           // optional per-case timeout, default 120
      "checks": [
        { "kind": "fileExists", "path": "hello.txt" },
        { "kind": "fileContains", "path": "hello.txt", "text": "hi" },
        { "kind": "fileNotExists", "path": ".git" },
        { "kind": "command", "run": "node hello.js", "expectExit": 0 },
        { "kind": "outputMatches", "pattern": "\\bdone\\b", "flags": "i" }
      ]
    }
  ]
}
```

Validation is strict: unknown keys, wrong types, empty strings where content is required,
invalid regex patterns and duplicate case ids all fail with a precise error such as
`invalid suite at cases[0].checks[2].pattern: invalid regular expression /(/`.

## CLI

```sh
gz-bench validate <suite.json>
    Structural validation only. Exit 0 if valid.

gz-bench run <suite.json> --cmd "<template>" [--timeout n] [--json] [--keep]
    Run all cases. Per case: create temp workspace -> run setup commands
    (first nonzero exit fails the case immediately) -> run the rendered command
    under timeoutSec -> evaluate checks in order -> delete the workspace
    (unless --keep).

    --cmd      required command template; {{prompt}} and {{dir}} are substituted
    --timeout  override every case timeout in seconds
    --json     print the JSON report instead of the console table
    --keep     keep workspaces and print their paths for debugging

gz-bench init [outDir]
    Write example-suite.json whose demo cases pass with --cmd "echo done".

Exit codes: 0 = all passed, 1 = at least one case failed, 2 = usage/validation error.
```

## Check kinds

Checks are evaluated in order against the workspace after the agent command finishes.
A case passes when every check passes. A case with zero checks passes vacuously.

| Kind            | Fields                        | Passes when                                                        |
| --------------- | ----------------------------- | ------------------------------------------------------------------ |
| `fileExists`    | `path`                        | path exists inside the workspace                                    |
| `fileContains`  | `path`, `text`, `flags?`      | file exists and contains `text`; `flags: "i"` = case-insensitive    |
| `fileNotExists` | `path`                        | path does not exist inside the workspace                            |
| `command`       | `run`, `expectExit?`          | shell command run in the workspace exits with `expectExit` (def. 0) |
| `outputMatches` | `pattern`, `flags?`           | regex matches combined stdout+stderr of the agent command           |

Relative `path` values resolve inside the case workspace. The agent command's exit code is captured
but not asserted implicitly - assert it yourself via a `command` or `outputMatches` check.

## Report format

With `--json` the harness prints a single machine-readable report:

```json
{
  "summary": { "total": 3, "passed": 2, "failed": 1 },
  "results": [
    {
      "id": "write-hello",
      "passed": true,
      "durationMs": 1204,
      "exitCode": 0,
      "checkResults": [
        { "kind": "fileExists", "path": "hello.txt", "passed": true }
      ]
    }
  ]
}
```

Pipe it to `jq` for gate logic: `gz-bench run suite.json --cmd "..." --json | jq -e '.summary.failed == 0'`.

## CI integration

The harness is built for pipelines: deterministic checks, per-case timeouts, structured output,
and distinct exit codes (0 pass / 1 failure / 2 usage error). A minimal GitHub Actions job:

```yaml
- run: npm install -g @ground-zero-llc/gz-bench
- run: gz-bench run suite.json --cmd "my-agent --workdir {{dir}} \"{{prompt}}\"" --json > report.json
- run: node -e "const r=require('./report.json'); process.exit(r.summary.failed ? 1 : 0)"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development gate, and this repo's own
[CI workflow](.github/workflows/ci.yml) which runs typecheck + tests + build on every push.

## Security

Suites execute arbitrary local commands (setup commands, the rendered `--cmd` template, `command`
checks) with your user privileges, in a shell. There is no sandboxing. Only run suites you trust;
treat untrusted suite files like untrusted shell scripts. Workspaces are deleted after each case
unless `--keep` is set.

## Development

```sh
npm install        # devDependencies only; runtime has zero dependencies
npm run typecheck  # strict tsc over src/ and test/
npm test           # node:test runner (Node >= 24 native TS type-stripping)
npm run build      # emit dist/ via tsc
```

Layout: `src/types.ts` (types + defaults), `src/validate.ts` (loadSuite/validateSuite),
`src/runner.ts` (runSuite), `src/report.ts` (renderReport/toJSON), `src/cli.ts`.
Tests live in `test/*.test.ts`, use temp dirs only, and never touch `$HOME`.

## Contributing

PRs welcome - see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the mandatory gate
(`typecheck + test + build`), and project guidelines.

## License

[MIT](LICENSE) © oke3
