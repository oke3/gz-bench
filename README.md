# gz-bench

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Ground Zero LLC](https://img.shields.io/badge/Built%20by-Ground%20Zero%20LLC-purple)](https://github.com/oke3)
[![npm](https://img.shields.io/npm/v/@ground-zero-llc/gz-bench)](https://www.npmjs.com/package/@ground-zero-llc/gz-bench)
[![CI](https://github.com/oke3/gz-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/oke3/gz-bench/actions)

> Your agent says it works. Prove it.

A standardized benchmark harness for AI coding-agent skills. You describe test cases in a declarative JSON suite; the harness runs each case in an isolated temp workspace using your command template, then scores deterministic filesystem and command assertions. It never calls any LLM or API itself — you bring the agent, `gz-bench` brings the methodology.

---

## Table of Contents

- [Why](#why)
- [Quick Start](#quick-start)
- [Install](#install)
- [Architecture](#architecture)
- [Suite Format](#suite-format)
- [Check Kinds](#check-kinds)
- [Writing Good Assertions](#writing-good-assertions)
- [CLI Reference](#cli-reference)
- [Report Format](#report-format)
- [Feature Highlights](#feature-highlights)
- [CI Integration](#ci-integration)
- [Security](#security)
- [Development](#development)
- [Related Projects](#related-projects)
- [Contributing](#contributing)
- [License](#license)

## Why

Benchmarking coding agents is usually ad hoc: hand-rolled scripts, shared state between runs, non-reproducible workspaces, and no structured results. `gz-bench` fixes the harness layer:

- **Declarative suites** — cases are plain JSON, reviewable and diffable.
- **Isolation** — every case runs in its own fresh temp workspace (`os.tmpdir()`), so cases cannot interfere with each other or with your machine.
- **Deterministic scoring** — checks are pure filesystem/command assertions, not LLM judgments.
- **Structured output** — human table or machine-readable `--json` report for CI pipelines.

## Quick Start

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

## Install

Requires Node.js >= 18.

```sh
npm install -g @ground-zero-llc/gz-bench
```

Or run from a checkout:

```sh
npm install && npm run build && node dist/cli.js --help
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    gz-bench CLI                         │
│                                                         │
│  ┌──────────┐   ┌───────────┐   ┌───────────────────┐  │
│  │  init    │   │ validate  │   │      run          │  │
│  │ scaffold │   │  suite    │   │  cases + score    │  │
│  └──────────┘   └─────┬─────┘   └────────┬──────────┘  │
│                       │                   │              │
└───────────────────────┼───────────────────┼──────────────┘
                        │                   │
               ┌────────▼────────┐  ┌───────▼───────────┐
               │  validate.ts    │  │    runner.ts       │
               │  loadSuite()    │  │    runCase()       │
               │  validateSuite()│  │    runSuite()      │
               └─────────────────┘  │    renderTemplate()│
                                    │    evalCheck()     │
                                    └───────┬───────────┘
                                            │
                              ┌─────────────▼─────────────┐
                              │     Per-Case Execution     │
                              │                           │
                              │  1. mkdtemp (isolated)    │
                              │  2. run setup commands    │
                              │  3. render & run --cmd    │
                              │  4. evaluate checks       │
                              │  5. cleanup (or --keep)   │
                              └───────────────────────────┘
                                            │
                              ┌─────────────▼─────────────┐
                              │      report.ts            │
                              │  renderReport (table)     │
                              │  toJSON (machine)         │
                              └───────────────────────────┘
```

**Validation** (`validate.ts`): loads a JSON suite file, rejects unknown keys, validates types, checks regex patterns, detects duplicate case ids. Returns a typed `Suite` object.

**Runner** (`runner.ts`): creates an isolated temp directory per case, runs setup commands, renders and executes the agent template, captures stdout/stderr, evaluates checks in order, cleans up.

**Reporting** (`report.ts`): renders a human-readable table or a machine-readable JSON report with `summary` and per-case `checkResults`.

## Suite Format

A suite is a JSON file describing what to test. Here's the full schema with every field:

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

Validation is strict: unknown keys, wrong types, empty strings where content is required, invalid regex patterns and duplicate case ids all fail with a precise error such as:

```
invalid suite at cases[0].checks[2].pattern: invalid regular expression /(/
```

### Suite fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | `string` | yes | Non-empty, identifies the suite |
| `description` | `string` | no | Human-readable description |
| `version` | `string` | no | Semver string for tracking |
| `cases` | `Case[]` | yes | Array of test cases |

### Case fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | yes | Unique within the suite |
| `prompt` | `string` | yes | The prompt sent to the agent (via `{{prompt}}` placeholder) |
| `setup` | `string[]` | no | Shell commands run before the agent; first nonzero exit fails the case |
| `checks` | `Check[]` | yes | Assertions evaluated after the agent command |
| `timeoutSec` | `number` | no | Per-case timeout in seconds (default: 120) |

## Check Kinds

Checks are evaluated in order against the workspace after the agent command finishes.
A case passes when every check passes. A case with zero checks passes vacuously.

| Kind            | Fields                        | Passes when                                                        |
| --------------- | ----------------------------- | ------------------------------------------------------------------ |
| `fileExists`    | `path`                        | path exists inside the workspace                                    |
| `fileContains`  | `path`, `text`, `flags?`      | file exists and contains `text`; `flags: "i"` = case-insensitive    |
| `fileNotExists` | `path`                        | path does not exist inside the workspace                            |
| `command`       | `run`, `expectExit?`          | shell command run in the workspace exits with `expectExit` (def. 0) |
| `outputMatches` | `pattern`, `flags?`           | regex matches combined stdout+stderr of the agent command           |

Relative `path` values resolve inside the case workspace. The agent command's exit code is captured but not asserted implicitly — assert it yourself via a `command` or `outputMatches` check.

## Writing Good Assertions

Effective benchmarks are built on precise, testable assertions. Here are patterns and anti-patterns:

### ✅ Good patterns

```jsonc
// 1. Assert specific file content, not just existence
{ "kind": "fileContains", "path": "src/index.ts", "text": "export function" }

// 2. Use regex for output verification
{ "kind": "outputMatches", "pattern": "^PASS:\\s+\\d+ tests" }

// 3. Test the actual behavior, not the implementation
{ "kind": "command", "run": "node dist/cli.js --version", "expectExit": 0 }

// 4. Assert something DOESN'T exist (agent didn't create junk)
{ "kind": "fileNotExists", "path": ".env.local" }

// 5. Case-insensitive matching for flexible content
{ "kind": "fileContains", "path": "README.md", "text": "install", "flags": "i" }
```

### ❌ Anti-patterns

```jsonc
// 1. Don't just check file exists — what's IN it matters
{ "kind": "fileExists", "path": "index.js" }  // too vague

// 2. Don't over-specify exact output format
{ "kind": "outputMatches", "pattern": "^Done\\.$" }  // brittle

// 3. Don't rely on timing or ordering
{ "kind": "command", "run": "sleep 1 && echo ok" }  // fragile

// 4. Don't forget the happy path
// If you only assert fileExists, the agent might create an empty file
```

### Tips

- **Order checks from most important to least** — the harness stops evaluating on first failure.
- **Use `command` checks for runtime behavior** — `node file.js`, `python script.py`, `go test ./...`.
- **Use `outputMatches` for log verification** — the agent's combined stdout+stderr is matched.
- **Use `fileContains` over `fileExists`** — existence alone proves little.
- **Keep prompts specific** — "Create hello.txt containing 'hi'" beats "Write a file".

## CLI Reference

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

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All cases passed (or `validate`/`init` succeeded) |
| `1` | One or more cases failed |
| `2` | Usage or validation error |

## Report Format

With `--json` the harness prints a single machine-readable report:

```json
{
  "summary": { "total": 3, "passed": 2, "failed": 1 },
  "results": [
    {
      "id": "write-hello",
      "passed": true,
      "durationMs": 1204,
      "checkResults": [
        { "kind": "fileExists", "path": "hello.txt", "passed": true }
      ]
    }
  ]
}
```

The default output is a human-readable table:

```
id            result  checks  time     first failure
-----------   ------  ------  -------  ---------------
write-hello   PASS    1/1     1204ms
write-world   FAIL    0/1     892ms    file does not exist: world.txt
echo-test     PASS    1/1     203ms
```

Pipe to `jq` for gate logic: `gz-bench run suite.json --cmd "..." --json | jq -e '.summary.failed == 0'`.

## Feature Highlights

- **Zero runtime dependencies** — Node built-ins only. Nothing to audit, nothing to break.
- **Strict JSON validation** — rejects unknown keys, wrong types, invalid regex, duplicate ids.
- **Full isolation** — each case runs in its own `os.tmpdir()` workspace. Cases cannot interfere.
- **Deterministic scoring** — no LLM calls, no randomness. Same input → same output.
- **Structured reports** — machine-readable JSON for CI pipelines, human-readable table for local use.
- **Cross-platform** — Linux, macOS, Windows (with `taskkill` process cleanup).

## CI Integration

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

Suites execute arbitrary local commands (setup commands, the rendered `--cmd` template, `command` checks) with your user privileges, in a shell. There is no sandboxing. Only run suites you trust;
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

## Related Projects

| Project | What It Does |
|---------|-------------|
| [gz-sessions](https://github.com/oke3/gz-sessions) | Persistent cross-session memory for AI agents |
| [gz-sessionrecall](https://github.com/oke3/gz-sessionrecall) | AI code archaeology — search your session history |
| [gz-codemap](https://github.com/oke3/gz-codemap) | Scan codebases → auto-generate project config |
| [gz-modelrouter](https://github.com/oke3/gz-modelrouter) | Intelligent LLM cost router — save 40-70% on bills |
| [gz-gateway](https://github.com/oke3/gz-gateway) | OpenAI-compatible AI gateway — rate limiting, caching, failover, cost tracking |
| [gz-bench](https://github.com/oke3/gz-bench) | Standardized benchmark harness for AI coding agents |
| [gz-authmesh](https://github.com/oke3/gz-authmesh) | Unified credential mesh for AI providers |
| [gz-remote](https://github.com/oke3/gz-remote) | Drive AI coding agents on remote machines over SSH |
| [gz-context-engine](https://github.com/oke3/gz-context-engine) | Production-grade RAG context engine |

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the mandatory gate
(`typecheck + test + build`), and project guidelines.

---

## Enterprise Support

Need this customized for your infrastructure? We offer:

- **Integration consulting** — Wire gz-bench into your evaluation pipeline
- **Custom configuration** — Task-specific rules, models, and workflows for your team
- **Managed deployment** — We host and maintain your instance
- **Training workshops** — Hands-on sessions for your engineering team

[Book a 30-min call](https://www.grndxero.com/brief) · [See pricing](https://www.grndxero.com/pricing)

---

## License

MIT — Ground Zero LLC

---

Built by [Ground Zero LLC](https://github.com/oke3) — AI infrastructure for the agentic age.
