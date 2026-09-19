// Copyright (c) 2026 Ground Zero LLC. All rights reserved.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import path from "node:path";
import { runSuite, WORKSPACE_PREFIX } from "../src/runner.ts";
import type { Case, RunOptions, Suite } from "../src/types.ts";

function suiteOf(cases: Case[]): Suite {
  return { name: "runner-test", cases };
}

function opts(cmd: string, extra: Partial<RunOptions> = {}): RunOptions {
  return { cmd, ...extra };
}

const SLEEP_30S = 'node -e "setTimeout(function () {}, 30000)"';

test("template renders {{dir}} into the isolated workspace", async () => {
  const suite = suiteOf([
    {
      id: "render-dir",
      prompt: "irrelevant",
      checks: [
        { kind: "fileExists", path: "marker.txt" },
        { kind: "fileContains", path: "marker.txt", text: "ok" },
      ],
    },
  ]);
  const results = await runSuite(
    suite,
    opts(`node -e "require('fs').writeFileSync(process.argv[1] + '/marker.txt', 'ok')" "{{dir}}"`),
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]?.passed, true, `expected pass, got: ${JSON.stringify(results[0])}`);
});

test("template renders {{prompt}} and replaces every occurrence", async () => {
  const suite = suiteOf([
    {
      id: "render-prompt",
      prompt: "PING-PROMPT-123",
      checks: [{ kind: "outputMatches", pattern: "PING-PROMPT-123 PING-PROMPT-123" }],
    },
  ]);
  const results = await runSuite(suite, opts("echo {{prompt}} {{prompt}}"));
  assert.equal(results[0]?.passed, true, `expected pass, got: ${JSON.stringify(results[0])}`);
});

test("fileExists / fileNotExists evaluate against the workspace", async () => {
  const suite = suiteOf([
    {
      id: "exists-pass",
      prompt: "p",
      setup: ["echo data>present.txt"],
      checks: [{ kind: "fileExists", path: "present.txt" }],
    },
    {
      id: "exists-fail",
      prompt: "p",
      checks: [{ kind: "fileExists", path: "ghost.txt" }],
    },
    {
      id: "not-exists-pass",
      prompt: "p",
      checks: [{ kind: "fileNotExists", path: "ghost.txt" }],
    },
    {
      id: "not-exists-fail",
      prompt: "p",
      setup: ["echo data>there.txt"],
      checks: [{ kind: "fileNotExists", path: "there.txt" }],
    },
  ]);
  const [a, b, c, d] = await runSuite(suite, opts("echo done"));
  assert.equal(a?.passed, true);
  assert.equal(b?.passed, false);
  assert.match(b?.checkResults[0]?.reason ?? "", /file does not exist: ghost\.txt/);
  assert.equal(c?.passed, true);
  assert.equal(d?.passed, false);
  assert.match(d?.checkResults[0]?.reason ?? "", /file exists: there\.txt/);
});

test("fileContains is case-sensitive by default and supports flags i", async () => {
  const suite = suiteOf([
    {
      id: "contains",
      prompt: "p",
      setup: ["echo Hello-WORLD>f.txt"],
      checks: [
        { kind: "fileContains", path: "f.txt", text: "Hello-WORLD" },
        { kind: "fileContains", path: "f.txt", text: "hello-world", flags: "i" },
        { kind: "fileContains", path: "f.txt", text: "goodbye" },
        { kind: "fileContains", path: "missing.txt", text: "x" },
      ],
    },
  ]);
  const results = await runSuite(suite, opts("echo done"));
  const checks = results[0]?.checkResults ?? [];
  assert.deepEqual(checks.map((c) => c.passed), [true, true, false, false]);
  assert.match(checks[2]?.reason ?? "", /does not contain "goodbye"/);
  assert.match(checks[3]?.reason ?? "", /file not found: missing\.txt/);
  assert.equal(results[0]?.passed, false);
});

test("command checks compare exit codes (default expectExit 0)", async () => {
  const suite = suiteOf([
    {
      id: "commands",
      prompt: "p",
      checks: [
        { kind: "command", run: "echo hi" },
        { kind: "command", run: 'node -e "process.exit(7)"', expectExit: 7 },
        { kind: "command", run: 'node -e "process.exit(7)"' },
        { kind: "command", run: "echo ok", expectExit: 1 },
      ],
    },
  ]);
  const results = await runSuite(suite, opts("echo done"));
  const checks = results[0]?.checkResults ?? [];
  assert.deepEqual(checks.map((c) => c.passed), [true, true, false, false]);
  assert.match(checks[2]?.reason ?? "", /exited with code 7, expected 0/);
  assert.match(checks[3]?.reason ?? "", /expected 1/);
});

test("outputMatches scans combined stdout and stderr", async () => {
  const suite = suiteOf([
    {
      id: "output",
      prompt: "p",
      checks: [
        { kind: "outputMatches", pattern: "ALPHA" },
        { kind: "outputMatches", pattern: "alpha" },
        { kind: "outputMatches", pattern: "TO-STDERR-9" },
        { kind: "outputMatches", pattern: "zeta" },
      ],
    },
  ]);
  const results = await runSuite(suite, opts('node -e "console.log(\'alpha\'); console.error(\'TO-STDERR-9\')"'));
  const checks = results[0]?.checkResults ?? [];
  assert.deepEqual(checks.map((c) => c.passed), [false, true, true, false]);
  assert.match(checks[0]?.reason ?? "", /output does not match \/ALPHA\//);
});

test("checks are evaluated even when the agent command exits nonzero", async () => {
  const suite = suiteOf([
    {
      id: "nonzero-but-checked",
      prompt: "p",
      checks: [{ kind: "outputMatches", pattern: "OUT-77" }],
    },
  ]);
  const results = await runSuite(suite, opts('node -e "console.log(\'OUT-77\'); process.exit(7)"'));
  assert.equal(results[0]?.passed, true);
  assert.equal(results[0]?.error, undefined);
});

test("cases run in isolated temp workspaces", async () => {
  const suite = suiteOf([
    {
      id: "writer",
      prompt: "p",
      setup: ["echo A>a-created.txt"],
      checks: [{ kind: "fileExists", path: "a-created.txt" }],
    },
    {
      id: "reader",
      prompt: "p",
      setup: ["echo B>b-created.txt"],
      checks: [
        { kind: "fileNotExists", path: "a-created.txt" },
        { kind: "fileExists", path: "b-created.txt" },
      ],
    },
  ]);
  const results = await runSuite(suite, opts("echo done"));
  assert.deepEqual(
    results.map((r) => r.passed),
    [true, true],
  );
});

test("setup failure fails the case fast without running checks", async () => {
  const suite = suiteOf([
    {
      id: "bad-setup",
      prompt: "p",
      setup: ['node -e "console.error(\'boom\'); process.exit(3)"', "echo x>never.txt"],
      checks: [{ kind: "fileExists", path: "never.txt" }],
    },
  ]);
  const results = await runSuite(suite, opts("echo done"));
  const r = results[0];
  assert.equal(r?.passed, false);
  assert.match(r?.error ?? "", /setup command exited with code 3/);
  assert.match(r?.error ?? "", /boom/);
  assert.equal(r?.checkResults.length, 0);
});

test("per-case timeoutSec is enforced and kills the process tree", async () => {
  const suite = suiteOf([{ id: "slow", prompt: "p", timeoutSec: 1, checks: [] }]);
  const started = Date.now();
  const results = await runSuite(suite, opts(SLEEP_30S));
  const r = results[0];
  assert.equal(r?.passed, false);
  assert.match(r?.error ?? "", /case timed out after 1s/);
  assert.equal(r?.durationMs < 15000, true);
  assert.equal(r?.checkResults.length, 0);
  assert.ok(Date.now() - started < 20000);
});

test("--timeout override beats per-case timeoutSec", async () => {
  const suite = suiteOf([{ id: "overridden", prompt: "p", timeoutSec: 300, checks: [] }]);
  const results = await runSuite(suite, opts(SLEEP_30S, { timeoutSec: 1 }));
  assert.match(results[0]?.error ?? "", /case timed out after 1s/);
});

test("keep option preserves the workspace for inspection", async () => {
  const suite = suiteOf([
    {
      id: "kept",
      prompt: "p",
      checks: [{ kind: "command", run: "echo kept>x.txt" }, { kind: "fileExists", path: "x.txt" }],
    },
  ]);
  const results = await runSuite(suite, opts("echo done", { keep: true }));
  const keptDir = results[0]?.keptDir;
  try {
    assert.ok(keptDir);
    assert.match(path.basename(keptDir), new RegExp(`^${WORKSPACE_PREFIX}`));
    assert.equal(fs.existsSync(path.join(keptDir, "x.txt")), true);
  } finally {
    if (keptDir !== undefined) fs.rmSync(keptDir, { recursive: true, force: true });
  }
});

test("default behavior cleans up workspaces unless keep is set", async () => {
  const sentinel = `sentinel-${Date.now()}-${Math.floor(Math.random() * 1e9)}.txt`;
  const suite = suiteOf([
    {
      id: "cleanup",
      prompt: "p",
      checks: [{ kind: "command", run: `echo bye>${sentinel}` }],
    },
  ]);
  const results = await runSuite(suite, opts("echo done"));
  assert.equal(results[0]?.passed, true);
  assert.equal(results[0]?.keptDir, undefined);
  const leftovers = fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith(WORKSPACE_PREFIX))
    .map((name) => path.join(os.tmpdir(), name, sentinel))
    .filter((p) => fs.existsSync(p));
  assert.deepEqual(leftovers, []);
});
