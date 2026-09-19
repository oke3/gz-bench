// Copyright (c) 2026 Ground Zero LLC. All rights reserved.

import fs from "node:fs";
import type { Case, Check, Suite } from "./types.ts";

export class ValidationError extends Error {
  override name = "ValidationError";
}

const CHECK_KINDS = [
  "fileExists",
  "fileContains",
  "fileNotExists",
  "command",
  "outputMatches",
] as const;

const SUITE_KEYS: ReadonlySet<string> = new Set(["name", "description", "version", "cases"]);
const CASE_KEYS: ReadonlySet<string> = new Set(["id", "prompt", "setup", "checks", "timeoutSec"]);
const CHECK_KEYS: ReadonlySet<string> = new Set(["kind", "path", "text", "flags", "run", "expectExit", "pattern"]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(at: string, message: string): never {
  throw new ValidationError(`invalid suite at ${at}: ${message}`);
}

function expectObject(value: unknown, at: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(at, `expected an object, got ${typeOf(value)}`);
  return value;
}

function expectString(
  obj: Record<string, unknown>,
  key: string,
  at: string,
  opts: { required: boolean; nonEmpty?: boolean },
): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    if (opts.required) fail(`${at}.${key}`, `missing required field "${key}"`);
    return undefined;
  }
  if (typeof value !== "string") fail(`${at}.${key}`, `expected a string, got ${typeOf(value)}`);
  if (opts.nonEmpty && value.length === 0) fail(`${at}.${key}`, "must be a non-empty string");
  return value;
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>, at: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail(at, `unknown key "${key}"`);
  }
}

function expectStringArray(obj: Record<string, unknown>, key: string, at: string): string[] | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`${at}.${key}`, `expected an array of strings, got ${typeOf(value)}`);
  return value.map((item, i) => {
    if (typeof item !== "string") fail(`${at}.${key}[${i}]`, `expected a string, got ${typeOf(item)}`);
    return item;
  });
}

function expectFlags(obj: Record<string, unknown>, at: string): "i" | undefined {
  const value = obj.flags;
  if (value === undefined) return undefined;
  if (value !== "i") fail(`${at}.flags`, `expected "i" or omitted, got ${JSON.stringify(value)}`);
  return value;
}

function validateCheck(raw: unknown, at: string): Check {
  const check = expectObject(raw, at);
  rejectUnknownKeys(check, CHECK_KEYS, at);
  const kind = check.kind;
  if (typeof kind !== "string") fail(`${at}.kind`, `expected a string, got ${typeOf(kind)}`);
  switch (kind as string) {
    case "fileExists":
    case "fileNotExists": {
      const path = expectString(check, "path", at, { required: true, nonEmpty: true });
      return kind === "fileExists" ? { kind: "fileExists", path: path! } : { kind: "fileNotExists", path: path! };
    }
    case "fileContains": {
      const path = expectString(check, "path", at, { required: true, nonEmpty: true })!;
      const text = expectString(check, "text", at, { required: true });
      const flags = expectFlags(check, at);
      return flags === undefined ? { kind: "fileContains", path, text: text! } : { kind: "fileContains", path, text: text!, flags };
    }
    case "command": {
      const run = expectString(check, "run", at, { required: true, nonEmpty: true })!;
      const expectExit = check.expectExit;
      if (expectExit === undefined) return { kind: "command", run };
      if (typeof expectExit !== "number" || !Number.isInteger(expectExit)) {
        fail(`${at}.expectExit`, `expected an integer, got ${JSON.stringify(expectExit)}`);
      }
      return { kind: "command", run, expectExit };
    }
    case "outputMatches": {
      const pattern = expectString(check, "pattern", at, { required: true, nonEmpty: true })!;
      const flags = expectFlags(check, at);
      try {
        void new RegExp(pattern, flags === undefined ? "" : flags);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fail(`${at}.pattern`, `invalid regular expression /${pattern}/: ${message}`);
      }
      return flags === undefined ? { kind: "outputMatches", pattern } : { kind: "outputMatches", pattern, flags };
    }
    default:
      fail(`${at}.kind`, `unknown check kind ${JSON.stringify(kind)}; expected one of: ${CHECK_KINDS.join(", ")}`);
  }
}

function validateCase(raw: unknown, index: number): Case {
  const at = `cases[${index}]`;
  const c = expectObject(raw, at);
  rejectUnknownKeys(c, CASE_KEYS, at);
  const id = expectString(c, "id", at, { required: true, nonEmpty: true })!;
  const prompt = expectString(c, "prompt", at, { required: true })!;
  const setup = expectStringArray(c, "setup", at);
  const checksRaw = c.checks;
  if (checksRaw === undefined) fail(`${at}.checks`, "missing required field \"checks\"");
  if (!Array.isArray(checksRaw)) fail(`${at}.checks`, `expected an array, got ${typeOf(checksRaw)}`);
  const checks = checksRaw.map((raw, i) => validateCheck(raw, `${at}.checks[${i}]`));
  const timeoutSec = c.timeoutSec;
  if (timeoutSec !== undefined) {
    if (typeof timeoutSec !== "number" || !Number.isFinite(timeoutSec) || timeoutSec <= 0) {
      fail(`${at}.timeoutSec`, `expected a positive finite number, got ${JSON.stringify(timeoutSec)}`);
    }
  }
  return setup === undefined
    ? { id, prompt, checks, ...(timeoutSec !== undefined ? { timeoutSec } : {}) }
    : { id, prompt, setup, checks, ...(timeoutSec !== undefined ? { timeoutSec } : {}) };
}

export function validateSuite(data: unknown): Suite {
  const root = expectObject(data, "root");
  rejectUnknownKeys(root, SUITE_KEYS, "root");
  const name = expectString(root, "name", "root", { required: true, nonEmpty: true })!;
  const description = expectString(root, "description", "root", { required: false });
  const version = expectString(root, "version", "root", { required: false });
  const casesRaw = root.cases;
  if (casesRaw === undefined) fail("root.cases", "missing required field \"cases\"");
  if (!Array.isArray(casesRaw)) fail("root.cases", `expected an array, got ${typeOf(casesRaw)}`);
  const cases = casesRaw.map((raw, i) => validateCase(raw, i));
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) fail("cases", `duplicate case id ${JSON.stringify(c.id)}; case ids must be unique`);
    seen.add(c.id);
  }
  const suite: Suite = { name, cases };
  if (description !== undefined) suite.description = description;
  if (version !== undefined) suite.version = version;
  return suite;
}

export function loadSuite(filePath: string): Suite {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`cannot read suite file "${filePath}": ${message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`invalid JSON in "${filePath}": ${message}`);
  }
  return validateSuite(data);
}
