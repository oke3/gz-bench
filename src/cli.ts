// Copyright (c) 2026 Ground Zero LLC. All rights reserved.

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { renderReport, toJSON } from "./report.ts";
import { runSuite } from "./runner.ts";
import { loadSuite } from "./validate.ts";
import type { Suite } from "./types.ts";

const USAGE = `gz-bench - standardized benchmark harness for AI coding-agent skills

Usage:
  gz-bench validate <suite.json>
      Validate a suite file and print a summary.

  gz-bench run <suite.json> --cmd "<command template>" [--timeout n] [--json] [--keep]
      Run every case in an isolated temp workspace.
      Placeholders in the template:
        {{prompt}}  replaced with the case prompt
        {{dir}}     replaced with the case workspace directory
      --timeout n   override every case timeout (seconds)
      --json        emit a machine-readable JSON report instead of a table
      --keep        keep case workspaces instead of deleting them

  gz-bench init [outDir]
      Write example-suite.json; its demo cases pass with --cmd "echo done".

Exit codes:
  0  all cases passed (or validate/init succeeded)
  1  one or more cases failed
  2  usage or validation error

Security: suites execute arbitrary local commands. Only run suites you trust.`;

const EXAMPLE_SUITE = {
  name: "example-suite",
  description:
    'Demo suite for gz-bench. Run it with: gz-bench run example-suite.json --cmd "echo done"',
  version: "0.1.0",
  cases: [
    {
      id: "echo-exit-code",
      prompt: "Print the word: done",
      checks: [
        { kind: "command", run: "echo done", expectExit: 0 },
        { kind: "fileNotExists", path: "missing.txt" },
      ],
    },
    {
      id: "echo-output",
      prompt: "Print exactly: done",
      checks: [{ kind: "outputMatches", pattern: "^done\\s*$" }],
    },
    {
      id: "echo-case-insensitive",
      prompt: "Print the word DONE.",
      timeoutSec: 30,
      checks: [
        { kind: "outputMatches", pattern: "\\bdone\\b", flags: "i" },
        { kind: "fileExists", path: "." },
      ],
    },
  ],
} satisfies Suite;

interface ParsedArgs {
  positionals: string[];
  cmd?: string;
  timeout?: number;
  json: boolean;
  keep: boolean;
}

class UsageError extends Error {
  override name = "UsageError";
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [], json: false, keep: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--cmd") {
      const value = args[++i];
      if (value === undefined) throw new UsageError('--cmd requires a value, e.g. --cmd "{{prompt}}"');
      parsed.cmd = value;
    } else if (arg === "--timeout") {
      const value = args[++i];
      if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
        throw new UsageError("--timeout requires a positive integer (seconds)");
      }
      parsed.timeout = Number.parseInt(value, 10);
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--keep") {
      parsed.keep = true;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option "${arg}"`);
    } else {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
}

function expectPositionals(parsed: ParsedArgs, command: string, min: number, max: number): void {
  if (parsed.positionals.length < min || parsed.positionals.length > max) {
    const range = min === max ? `${min}` : `[${min}..${max}]`;
    throw new UsageError(`command "${command}" expects ${range} positional argument(s), got ${parsed.positionals.length}`);
  }
}

async function cmdValidate(parsed: ParsedArgs): Promise<number> {
  expectPositionals(parsed, "validate", 1, 1);
  const suite = loadSuite(parsed.positionals[0] ?? "");
  console.log(`OK: ${suite.name} - ${suite.cases.length} case(s)`);
  return 0;
}

async function cmdRun(parsed: ParsedArgs): Promise<number> {
  expectPositionals(parsed, "run", 1, 1);
  if (parsed.cmd === undefined) {
    throw new UsageError('run requires --cmd "<command template>" (placeholders: {{prompt}}, {{dir}})');
  }
  const suitePath = parsed.positionals[0] ?? "";
  const suite = loadSuite(suitePath);
  const results = await runSuite(suite, {
    cmd: parsed.cmd,
    timeoutSec: parsed.timeout,
    keep: parsed.keep,
  });
  if (parsed.json) {
    process.stdout.write(toJSON(results));
  } else {
    process.stdout.write(renderReport(results));
  }
  if (parsed.keep) {
    for (const r of results) {
      if (r.keptDir !== undefined) console.log(`workspace kept: ${r.keptDir}`);
    }
  }
  return results.some((r) => !r.passed) ? 1 : 0;
}

async function cmdInit(parsed: ParsedArgs): Promise<number> {
  expectPositionals(parsed, "init", 0, 1);
  const outDir = path.resolve(parsed.positionals[0] ?? ".");
  const target = path.join(outDir, "example-suite.json");
  if (fs.existsSync(target)) {
    throw new Error(`refusing to overwrite existing file: ${target}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(EXAMPLE_SUITE, null, 2)}\n`);
  console.log(`wrote ${target}`);
  console.log(`next: gz-bench run ${path.join(path.relative(process.cwd(), target) || target)} --cmd "echo done"`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    console.error(USAGE);
    return 2;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return 0;
  }
  const parsed = parseArgs(rest);
  switch (command) {
    case "validate":
      return cmdValidate(parsed);
    case "run":
      return cmdRun(parsed);
    case "init":
      return cmdInit(parsed);
    default:
      throw new UsageError(`unknown command "${command}". Run "gz-bench help" for usage.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    process.exitCode = 2;
  },
);
