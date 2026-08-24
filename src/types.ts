export const DEFAULT_CASE_TIMEOUT_SEC = 120;
export const DEFAULT_EXPECT_EXIT = 0;

export type Check =
  | { kind: "fileExists"; path: string }
  | { kind: "fileContains"; path: string; text: string; flags?: "i" }
  | { kind: "fileNotExists"; path: string }
  | { kind: "command"; run: string; expectExit?: number }
  | { kind: "outputMatches"; pattern: string; flags?: "i" };

export interface Case {
  id: string;
  prompt: string;
  setup?: string[];
  checks: Check[];
  timeoutSec?: number;
}

export interface Suite {
  name: string;
  description?: string;
  version?: string;
  cases: Case[];
}

export interface CheckResult {
  kind: Check["kind"];
  passed: boolean;
  reason?: string;
}

export interface CaseResult {
  id: string;
  passed: boolean;
  durationMs: number;
  checkResults: CheckResult[];
  error?: string;
  keptDir?: string;
}

export interface RunOptions {
  cmd: string;
  timeoutSec?: number;
  keep?: boolean;
}
