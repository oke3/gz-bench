// Copyright (c) 2026 Ground Zero LLC. All rights reserved.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadSuite } from "../src/validate.ts";
import { runSuite } from "../src/runner.ts";
import type { Suite } from "../src/types.ts";
import { makeTempDir, runCli } from "./helpers.ts";

function writeJson(dir: string, name: string, data: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

const PASSING_SUITE = {
  name: "cli-pass",
  cases: [{ id: "ok", prompt: "p", checks: [{ kind: "outputMatches", pattern: "done" }] }],
};

test("init writes an example suite that validates and passes with --cmd \"echo done\"", async () => {
  const dir = makeTempDir();
  try {
    const run = await runCli(["init", dir]);
    assert.equal(run.code, 0, `stderr: ${run.stderr}`);
    const suitePath = path.join(dir, "example-suite.json");
    assert.equal(fs.existsSync(suitePath), true);
    const suite = loadSuite(suitePath);
    assert.ok(suite.cases.length >= 2);
    const results = await runSuite(suite, { cmd: "echo done" });
    assert.deepEqual(
      results.map((r) => r.passed),
      results.map(() => true),
    );
    assert.equal(results.length, suite.cases.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init refuses to overwrite an existing example", async () => {
  const dir = makeTempDir();
  try {
    const first = await runCli(["init", dir]);
    assert.equal(first.code, 0);
    const second = await runCli(["init", dir]);
    assert.equal(second.code, 2);
    assert.match(second.stderr, /refusing to overwrite/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validate exits 0 on a valid suite and prints a summary", async () => {
  const dir = makeTempDir();
  try {
    const file = writeJson(dir, "suite.json", PASSING_SUITE);
    const run = await runCli(["validate", file]);
    assert.equal(run.code, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /OK: cli-pass - 1 case\(s\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validate exits 2 on invalid JSON or unreadable files", async () => {
  const dir = makeTempDir();
  try {
    const broken = path.join(dir, "broken.json");
    fs.writeFileSync(broken, "{oops");
    const bad = await runCli(["validate", broken]);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /invalid JSON in/);

    const missing = await runCli(["validate", path.join(dir, "nope.json")]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /cannot read suite file/);

    const invalid = writeJson(dir, "invalid.json", { name: "s", cases: [{ id: "c", checks: [] }] });
    const struct = await runCli(["validate", invalid]);
    assert.equal(struct.code, 2);
    assert.match(struct.stderr, /invalid suite at cases\[0\]\.prompt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run prints a table and exits 0 when every case passes", async () => {
  const dir = makeTempDir();
  try {
    const file = writeJson(dir, "suite.json", PASSING_SUITE);
    const run = await runCli(["run", file, "--cmd", "echo done"]);
    assert.equal(run.code, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /\bok\b\s+PASS\s+1\/1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run exits 1 when a case fails and reports the first failure", async () => {
  const dir = makeTempDir();
  try {
    const file = writeJson(dir, "suite.json", {
      name: "cli-fail",
      cases: [
        { id: "broken", prompt: "p", checks: [{ kind: "fileExists", path: "ghost.txt" }] },
        { id: "fine", prompt: "p", checks: [{ kind: "command", run: "echo hi" }] },
      ],
    });
    const run = await runCli(["run", file, "--cmd", "echo done"]);
    assert.equal(run.code, 1);
    assert.match(run.stdout, /broken\s+FAIL\s+0\/1/);
    assert.match(run.stdout, /file does not exist: ghost\.txt/);
    assert.match(run.stdout, /fine\s+PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run --json emits a machine-readable report", async () => {
  const dir = makeTempDir();
  try {
    const file = writeJson(dir, "suite.json", PASSING_SUITE);
    const run = await runCli(["run", file, "--cmd", "echo done", "--json"]);
    assert.equal(run.code, 0);
    const parsed = JSON.parse(run.stdout) as {
      summary: { total: number; passed: number; failed: number };
      results: Array<{ id: string; passed: boolean; durationMs: number; checkResults: unknown[] }>;
    };
    assert.deepEqual(parsed.summary, { total: 1, passed: 1, failed: 0 });
    assert.equal(parsed.results[0]?.id, "ok");
    assert.equal(parsed.results[0]?.passed, true);
    assert.equal(typeof parsed.results[0]?.durationMs, "number");
    assert.ok(Array.isArray(parsed.results[0]?.checkResults));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run --keep preserves the workspace and reports its location", async () => {
  const dir = makeTempDir();
  try {
    const file = writeJson(dir, "suite.json", PASSING_SUITE);
    const run = await runCli(["run", file, "--cmd", "echo done", "--keep"]);
    assert.equal(run.code, 0);
    const match = run.stdout.match(/workspace kept: (.+)/);
    assert.ok(match);
    const keptDir = match[1]?.trim() ?? "";
    try {
      assert.equal(fs.existsSync(keptDir), true);
      assert.match(path.basename(keptDir), /^gz-bench-/);
    } finally {
      fs.rmSync(keptDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run usage errors exit 2", async () => {
  const dir = makeTempDir();
  try {
    const file = writeJson(dir, "suite.json", PASSING_SUITE);

    const noCmd = await runCli(["run", file]);
    assert.equal(noCmd.code, 2);
    assert.match(noCmd.stderr, /--cmd/);

    const badTimeout = await runCli(["run", file, "--cmd", "echo x", "--timeout", "abc"]);
    assert.equal(badTimeout.code, 2);
    assert.match(badTimeout.stderr, /--timeout/);

    const noFile = await runCli(["run", "--cmd", "echo x"]);
    assert.equal(noFile.code, 2);
    assert.match(noFile.stderr, /positional argument/);

    const unknownFlag = await runCli(["run", file, "--cmd", "echo x", "--wat"]);
    assert.equal(unknownFlag.code, 2);
    assert.match(unknownFlag.stderr, /unknown option "--wat"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("help exits 0; missing or unknown commands exit 2", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage:/);

  const none = await runCli([]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /Usage:/);

  const unknown = await runCli(["frobnicate"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown command "frobnicate"/);
});
