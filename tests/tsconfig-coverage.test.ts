/**
 * Audit C85: `tsc --noEmit` only checks what tsconfig.json `include` resolves
 * to, so a tracked .ts file outside that set (the fixtures/generate*.ts
 * generators were one) is silently never typechecked. This asserts the
 * resolved file set covers every git-tracked TypeScript source.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import ts from "typescript";

import { REPO_ROOT } from "./support/paths.js";

function resolvedProjectFiles(): Set<string> {
  const configPath = join(REPO_ROOT, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO_ROOT);
  return new Set(parsed.fileNames.map((f) => resolve(f)));
}

function trackedTypeScriptFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--", "*.ts", "*.mts", "*.cts", "*.tsx"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out.split("\n").filter((line) => line !== "");
}

describe("tsconfig coverage (audit C85)", () => {
  test("every git-tracked TypeScript file is part of the typechecked project", () => {
    const files = resolvedProjectFiles();
    const tracked = trackedTypeScriptFiles();
    expect(tracked.length).toBeGreaterThan(0);
    const missing = tracked.filter((rel) => !files.has(resolve(REPO_ROOT, rel)));
    expect(missing, `tracked .ts files tsc never checks: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("tsconfig gates dead code (audit C50)", () => {
  test("noUnusedLocals and noUnusedParameters are on, so an unused import, local or parameter fails typecheck", () => {
    const read = ts.readConfigFile(join(REPO_ROOT, "tsconfig.json"), ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO_ROOT).options;
    expect(options.noUnusedLocals).toBe(true);
    expect(options.noUnusedParameters).toBe(true);
  });
});
