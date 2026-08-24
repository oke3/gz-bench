import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function makeTempDir(prefix = "opencode-bench-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

const CLI_PATH = path.resolve("src", "cli.ts");

export function runCli(args: string[]): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, [CLI_PATH, ...args], { windowsHide: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
