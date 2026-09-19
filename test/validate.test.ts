// Copyright (c) 2026 Ground Zero LLC. All rights reserved.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { loadSuite, validateSuite, ValidationError } from "../src/validate.ts";
import type { Suite } from "../src/types.ts";
import { makeTempDir } from "./helpers.ts";

function expectInvalid(data: unknown, match: RegExp): void {
  assert.throws(
    () => validateSuite(data),
    (err: unknown) => err instanceof ValidationError && match.test(err.message),
    `expected ValidationError matching ${match}`,
  );
}

const VALID: Suite = {
  name: "demo",
  version: "1.0.0",
  description: "a valid suite",
  cases: [
    {
      id: "c1",
      prompt: "do something",
      setup: ["echo hi"],
      timeoutSec: 5,
      checks: [{ kind: "command", run: "echo hi", expectExit: 0 }],
    },
  ],
};

test("accepts a fully-populated valid suite and preserves fields", () => {
  const suite = validateSuite(JSON.parse(JSON.stringify(VALID)));
  assert.equal(suite.name, "demo");
  assert.equal(suite.version, "1.0.0");
  assert.equal(suite.description, "a valid suite");
  assert.equal(suite.cases.length, 1);
  assert.equal(suite.cases[0]?.id, "c1");
});

test("accepts every check kind", () => {
  const suite = validateSuite({
    name: "kinds",
    cases: [
      {
        id: "c",
        prompt: "p",
        checks: [
          { kind: "fileExists", path: "a.txt" },
          { kind: "fileNotExists", path: "b.txt" },
          { kind: "fileContains", path: "c.txt", text: "x", flags: "i" },
          { kind: "command", run: "echo hi" },
          { kind: "outputMatches", pattern: "hi", flags: "i" },
        ],
      },
    ],
  });
  assert.equal(suite.cases[0]?.checks.length, 5);
});

test("root must be an object", () => {
  expectInvalid([], /invalid suite at root: expected an object, got array/);
  expectInvalid(null, /expected an object, got null/);
  expectInvalid("nope", /expected an object, got string/);
});

test("name is required, non-empty string", () => {
  expectInvalid({ cases: [] }, /root\.name.*missing required field/);
  expectInvalid({ name: "", cases: [] }, /root\.name.*non-empty/);
  expectInvalid({ name: 42, cases: [] }, /root\.name.*expected a string, got number/);
});

test("cases is required and must be an array", () => {
  expectInvalid({ name: "s" }, /root\.cases.*missing required field/);
  expectInvalid({ name: "s", cases: "no" }, /root\.cases.*expected an array, got string/);
  expectInvalid({ name: "s", cases: {} }, /root\.cases.*expected an array, got object/);
});

test("unknown keys are rejected at every level", () => {
  expectInvalid({ name: "s", cases: [], extra: 1 }, /root: unknown key "extra"/);
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [], oops: true }] },
    /cases\[0\]: unknown key "oops"/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "fileExists", path: "a", wat: 1 }] }] },
    /cases\[0\]\.checks\[0\]: unknown key "wat"/,
  );
});

test("case requires id, prompt and checks with correct types", () => {
  const base = { prompt: "p", checks: [] };
  expectInvalid({ name: "s", cases: [base] }, /cases\[0\]\.id: missing required field "id"/);
  expectInvalid({ name: "s", cases: [{ ...base, id: "" }] }, /cases\[0\]\.id: must be a non-empty string/);
  expectInvalid({ name: "s", cases: [{ id: "c", checks: [] }] }, /cases\[0\]\.prompt: missing required field "prompt"/);
  expectInvalid({ name: "s", cases: [{ id: "c", prompt: "p" }] }, /cases\[0\]\.checks: missing required field "checks"/);
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: "all" }] },
    /cases\[0\]\.checks: expected an array, got string/,
  );
  expectInvalid(
    { name: "s", cases: ["not-an-object"] },
    /cases\[0\]: expected an object, got string/,
  );
});

test("setup must be an array of strings", () => {
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", setup: "echo", checks: [] }] },
    /cases\[0\]\.setup: expected an array of strings, got string/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", setup: ["ok", 7], checks: [] }] },
    /cases\[0\]\.setup\[1\]: expected a string, got number/,
  );
});

test("timeoutSec must be a positive finite number when present", () => {
  for (const bad of [0, -3, "10", Number.POSITIVE_INFINITY]) {
    expectInvalid(
      { name: "s", cases: [{ id: "c", prompt: "p", timeoutSec: bad, checks: [] }] },
      /cases\[0\]\.timeoutSec: expected a positive finite number/,
    );
  }
});

test("rejects unknown check kinds with the list of valid kinds", () => {
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "vibes" }] }] },
    /cases\[0\]\.checks\[0\]\.kind: unknown check kind "vibes"; expected one of: fileExists, fileContains, fileNotExists, command, outputMatches/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{}] }] },
    /cases\[0\]\.checks\[0\]\.kind: expected a string, got undefined/,
  );
});

test("file-based checks require a non-empty path", () => {
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "fileExists" }] }] },
    /cases\[0\]\.checks\[0\]\.path: missing required field "path"/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "fileNotExists", path: "" }] }] },
    /cases\[0\]\.checks\[0\]\.path: must be a non-empty string/,
  );
});

test("fileContains requires text; flags must be \"i\" if present", () => {
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "fileContains", path: "f" }] }] },
    /cases\[0\]\.checks\[0\]\.text: missing required field "text"/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "fileContains", path: "f", text: "t", flags: "g" }] }] },
    /cases\[0\]\.checks\[0\]\.flags: expected "i" or omitted, got "g"/,
  );
});

test("command requires run; expectExit must be an integer", () => {
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "command" }] }] },
    /cases\[0\]\.checks\[0\]\.run: missing required field "run"/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "command", run: "x", expectExit: 1.5 }] }] },
    /cases\[0\]\.checks\[0\]\.expectExit: expected an integer, got 1\.5/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "command", run: "x", expectExit: "0" }] }] },
    /cases\[0\]\.checks\[0\]\.expectExit: expected an integer/,
  );
});

test("outputMatches requires a pattern that compiles as a regex", () => {
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "outputMatches" }] }] },
    /cases\[0\]\.checks\[0\]\.pattern: missing required field "pattern"/,
  );
  expectInvalid(
    { name: "s", cases: [{ id: "c", prompt: "p", checks: [{ kind: "outputMatches", pattern: "(unclosed" }] }] },
    /cases\[0\]\.checks\[0\]\.pattern: invalid regular expression/
  );
});

test("duplicate case ids are rejected", () => {
  const data = {
    name: "s",
    cases: [
      { id: "dup", prompt: "p", checks: [] },
      { id: "dup", prompt: "p", checks: [] },
    ],
  };
  expectInvalid(data, /duplicate case id "dup"/);
});

test("loadSuite reads and validates a JSON file", () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "suite.json");
    fs.writeFileSync(file, JSON.stringify(VALID));
    const suite = loadSuite(file);
    assert.equal(suite.name, "demo");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadSuite reports invalid JSON precisely", () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "broken.json");
    fs.writeFileSync(file, "{ not json");
    assert.throws(() => loadSuite(file), (err: unknown) => err instanceof ValidationError && /invalid JSON in/.test(err.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadSuite reports unreadable files", () => {
  assert.throws(
    () => loadSuite(path.join(makeTempDir(), "missing.json")),
    (err: unknown) => err instanceof ValidationError && /cannot read suite file/.test(err.message),
  );
});
