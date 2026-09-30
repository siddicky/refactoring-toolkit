/**
 * Audit C85: `tsc --noEmit` only checks what tsconfig.json `include` resolves
 * to, so a tracked .ts file outside that set (the fixtures/generate*.ts
 * generators were one) is silently never typechecked. This asserts the
 * resolved file set covers every git-tracked TypeScript source.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolvedProjectFiles(): Set<string> {
  const configPath = join(repoRoot, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot);
  return new Set(parsed.fileNames.map((f) => resolve(f)));
}

function trackedTypeScriptFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--", "*.ts", "*.mts", "*.cts", "*.tsx"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\n").filter((line) => line !== "");
}

describe("tsconfig coverage (audit C85)", () => {
  test("every git-tracked TypeScript file is part of the typechecked project", () => {
    const files = resolvedProjectFiles();
    const tracked = trackedTypeScriptFiles();
    expect(tracked.length).toBeGreaterThan(0);
    const missing = tracked.filter((rel) => !files.has(resolve(repoRoot, rel)));
    expect(missing, `tracked .ts files tsc never checks: ${missing.join(", ")}`).toEqual([]);
  });

  test("the fixture generators are explicitly covered", () => {
    const files = resolvedProjectFiles();
    expect(files.has(resolve(repoRoot, "fixtures/generate.ts"))).toBe(true);
    expect(files.has(resolve(repoRoot, "fixtures/generate-creatorex.ts"))).toBe(true);
  });
});
