import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CASE_TIMEOUT_SEC, DEFAULT_EXPECT_EXIT } from "./types.ts";
import type { Case, CaseResult, Check, CheckResult, RunOptions, Suite } from "./types.ts";

export const WORKSPACE_PREFIX = "opencode-bench-";

interface ShellOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function renderTemplate(template: string, vars: { prompt: string; dir: string }): string {
  return template.replaceAll("{{prompt}}", vars.prompt).replaceAll("{{dir}}", vars.dir);
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellOutcome> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

function pass(kind: Check["kind"]): CheckResult {
  return { kind, passed: true };
}

function failCheck(kind: Check["kind"], reason: string): CheckResult {
  return { kind, passed: false, reason };
}

function fileExists(dir: string, relPath: string): boolean {
  return fs.existsSync(path.resolve(dir, relPath));
}

async function evalCheck(check: Check, dir: string, agentOutput: string, timeoutMs: number): Promise<CheckResult> {
  try {
    switch (check.kind) {
      case "fileExists":
        return fileExists(dir, check.path) ? pass(check.kind) : failCheck(check.kind, `file does not exist: ${check.path}`);
      case "fileNotExists":
        return !fileExists(dir, check.path)
          ? pass(check.kind)
          : failCheck(check.kind, `file exists: ${check.path}`);
      case "fileContains": {
        const abs = path.resolve(dir, check.path);
        if (!fs.existsSync(abs)) return failCheck(check.kind, `file not found: ${check.path}`);
        const content = fs.readFileSync(abs, "utf8");
        const caseInsensitive = check.flags === "i";
        const haystack = caseInsensitive ? content.toLowerCase() : content;
        const needle = caseInsensitive ? check.text.toLowerCase() : check.text;
        return haystack.includes(needle)
          ? pass(check.kind)
          : failCheck(check.kind, `file ${check.path} does not contain ${JSON.stringify(check.text)}`);
      }
      case "command": {
        const outcome = await runShell(check.run, dir, timeoutMs);
        if (outcome.timedOut) {
          const sec = Math.round(timeoutMs / 1000);
          return failCheck(check.kind, `command timed out after ${sec}s: ${check.run}`);
        }
        const expected = check.expectExit ?? DEFAULT_EXPECT_EXIT;
        return outcome.code === expected
          ? pass(check.kind)
          : failCheck(check.kind, `command exited with code ${outcome.code}, expected ${expected}: ${check.run}`);
      }
      case "outputMatches": {
        const re = new RegExp(check.pattern, check.flags === "i" ? "i" : "");
        return re.test(agentOutput)
          ? pass(check.kind)
          : failCheck(
              check.kind,
              `output does not match /${check.pattern}/${check.flags ?? ""}`,
            );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failCheck(check.kind, `check failed to run: ${message}`);
  }
}

function stderrTail(outcome: ShellOutcome): string {
  const trimmed = outcome.stderr.trim();
  if (trimmed.length === 0) return "";
  const tail = trimmed.length > 400 ? `...${trimmed.slice(-400)}` : trimmed;
  return `\n${tail}`;
}

async function runSetup(c: Case, dir: string, timeoutSec: number): Promise<string | undefined> {
  for (const cmd of c.setup ?? []) {
    const outcome = await runShell(cmd, dir, timeoutSec * 1000);
    if (outcome.timedOut) return `setup command timed out after ${timeoutSec}s: ${cmd}`;
    if (outcome.code !== 0) {
      return `setup command exited with code ${outcome.code}: ${cmd}${stderrTail(outcome)}`;
    }
  }
  return undefined;
}

export async function runSuite(suite: Suite, opts: RunOptions): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of suite.cases) {
    results.push(await runCase(c, opts));
  }
  return results;
}

async function runCase(c: Case, opts: RunOptions): Promise<CaseResult> {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  const timeoutSec = opts.timeoutSec ?? c.timeoutSec ?? DEFAULT_CASE_TIMEOUT_SEC;
  let error: string | undefined;
  let checkResults: CheckResult[] = [];
  try {
    error = await runSetup(c, dir, timeoutSec);
    if (error === undefined) {
      const rendered = renderTemplate(opts.cmd, { prompt: c.prompt, dir });
      const outcome = await runShell(rendered, dir, timeoutSec * 1000);
      if (outcome.timedOut) {
        error = `case timed out after ${timeoutSec}s`;
      } else {
        const agentOutput = outcome.stderr.length > 0 ? `${outcome.stdout}\n${outcome.stderr}` : outcome.stdout;
        checkResults = [];
        for (const check of c.checks) {
          checkResults.push(await evalCheck(check, dir, agentOutput, timeoutSec * 1000));
        }
      }
    }
  } finally {
    if (opts.keep === true) {
      // workspace intentionally preserved
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const result: CaseResult = {
    id: c.id,
    passed: error === undefined && checkResults.every((r) => r.passed),
    durationMs: Date.now() - started,
    checkResults,
  };
  if (error !== undefined) result.error = error;
  if (opts.keep === true) result.keptDir = dir;
  return result;
}
