import assert from "node:assert/strict";
import { test } from "node:test";
import { renderReport, toJSON } from "../src/report.ts";
import type { CaseResult } from "../src/types.ts";

function result(over: Partial<CaseResult>): CaseResult {
  return {
    id: "case-1",
    passed: true,
    durationMs: 123,
    checkResults: [],
    ...over,
  };
}

test("toJSON emits a parseable report with summary and results", () => {
  const results: CaseResult[] = [
    result({ id: "a", passed: true, durationMs: 10 }),
    result({
      id: "b",
      passed: false,
      durationMs: 20,
      error: "setup command exited with code 3: boom",
    }),
    result({
      id: "c",
      passed: false,
      durationMs: 30,
      checkResults: [{ kind: "fileExists", passed: false, reason: "file does not exist: x.txt" }],
    }),
  ];
  const parsed = JSON.parse(toJSON(results)) as {
    summary: { total: number; passed: number; failed: number };
    results: CaseResult[];
  };
  assert.deepEqual(parsed.summary, { total: 3, passed: 1, failed: 2 });
  assert.equal(parsed.results.length, 3);
  const b = parsed.results[1];
  assert.equal(b?.id, "b");
  assert.equal(b?.passed, false);
  assert.equal(b?.durationMs, 20);
  assert.equal(typeof b?.error, "string");
});

test("renderReport aligns columns and marks PASS/FAIL", () => {
  const results: CaseResult[] = [
    result({ id: "good", passed: true, durationMs: 5, checkResults: [
      { kind: "command", passed: true },
      { kind: "outputMatches", passed: true },
    ] }),
    result({
      id: "bad",
      passed: false,
      durationMs: 1500,
      checkResults: [
        { kind: "command", passed: true },
        { kind: "fileExists", passed: false, reason: "file does not exist: ghost.txt" },
      ],
    }),
  ];
  const text = renderReport(results);
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0] ?? "", /id\s+result\s+checks\s+time\s+first failure/);
  assert.match(lines[2] ?? "", /good\s+PASS\s+2\/2\s+5ms/);
  assert.match(lines[3] ?? "", /bad\s+FAIL\s+1\/2\s+1500ms\s+file does not exist: ghost\.txt/);
});

test("renderReport prefers the case error over check reasons and flattens newlines", () => {
  const r = result({
    id: "errored",
    passed: false,
    error: "case timed out after\n2s",
    checkResults: [],
  });
  const text = renderReport([r]);
  assert.match(text, /case timed out after 2s/);
  assert.doesNotMatch(text, /timed out after\n/);
});
