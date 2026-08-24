import type { CaseResult } from "./types.ts";

export interface SuiteReport {
  summary: { total: number; passed: number; failed: number };
  results: CaseResult[];
}

export function toJSON(results: CaseResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const report: SuiteReport = {
    summary: { total: results.length, passed, failed: results.length - passed },
    results,
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

function firstFailure(result: CaseResult): string {
  if (result.error !== undefined) return result.error;
  const failed = result.checkResults.find((c) => !c.passed);
  return failed?.reason ?? "";
}

function flatten(text: string, maxLen: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, Math.max(1, maxLen - 1))}...`;
}

const HEADERS = ["id", "result", "checks", "time", "first failure"] as const;

export function renderReport(results: CaseResult[]): string {
  const rows = results.map((r) => {
    const passedChecks = r.checkResults.filter((c) => c.passed).length;
    return [
      r.id,
      r.passed ? "PASS" : "FAIL",
      `${passedChecks}/${r.checkResults.length}`,
      `${r.durationMs}ms`,
      flatten(firstFailure(r), 80),
    ];
  });
  const widths = HEADERS.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const gutter = "  ";
  const lines: string[] = [];
  lines.push(HEADERS.map((h, i) => h.padEnd(widths[i] ?? 0)).join(gutter));
  lines.push(widths.map((w) => "-".repeat(w)).join(gutter));
  for (const row of rows) {
    lines.push(row.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join(gutter));
  }
  return `${lines.join("\n")}\n`;
}
