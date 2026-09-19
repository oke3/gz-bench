# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-24

### Added

- Declarative JSON benchmark suites (`cases`, `setup`, `timeoutSec`, `checks`).
- Isolated per-case temp workspaces with teardown (`--keep` to inspect).
- Five deterministic check kinds: `fileExists`, `fileContains`, `fileNotExists`,
  `command`, `outputMatches`.
- Strict structural validation with precise error paths (`gz-bench validate`).
- Command templating with `{{prompt}}` / `{{dir}}` placeholders.
- Human-readable report table and machine-readable `--json` output.
- `gz-bench init` scaffold with a self-verifying example suite.
- Exit codes: 0 pass, 1 failure, 2 usage/validation error.
