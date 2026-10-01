/**
 * INT-4 — every raw reviewer-verdict fixture follows T4b's contract.
 *
 * T4b made `finding.description` required, `evidence_span.snippet` required and
 * `disposition` a closed `fix | wontfix` enum (`citation_check` optional). Other
 * teams' tests build verdict JSON by hand: T2's review-step-identity,
 * jev-wiring and lane-b-gates tests did not carry `description`, so after the
 * merge they failed validation (or typecheck) even though each branch was green
 * alone. A typed builder is caught by tsc; a JSON.stringify'd reply is not, so
 * this scans the sources for finding literals and holds each to the contract.
 *
 * Files that build INVALID findings on purpose (negative tests of the contract
 * itself) are listed with the reason; each must still contain a conforming
 * literal, so they cannot quietly stop testing the positive case.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { DISPOSITIONS, validateFinding } from "../harness/agents/verdict-schema.js";

import { REPO_ROOT } from "./support/paths.js";
const SCANNED_DIRS = ["tests", "harness", "scripts", "src", "flows", "fixtures"];
const SCANNED_EXT = [".ts", ".json", ".jsonl"];

/** The schema module defines the contract; its own literals are not fixtures. */
const SCHEMA_MODULE = "harness/agents/verdict-schema.ts";

/** Negative tests of the contract: some literals are invalid on purpose. */
const NEGATIVE_TEST_FILES = new Set([
  "tests/agent-contracts.test.ts",
  "harness/agents/verdict-schema.test.ts",
  // this file's own examples
  "tests/verdict-fixture-contract.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".worktrees" || name.startsWith(".dex")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SCANNED_EXT.some((ext) => path.endsWith(ext))) out.push(path);
  }
  return out;
}

/** The `{ ... }` object literal (brace-matched) that encloses `at`, or null. */
function enclosingObject(text: string, at: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

interface FindingLiteral {
  file: string;
  line: number;
  conforms: boolean;
  problems: string[];
}

/** Every object literal that carries an `evidence_span` key (an agent-side finding). */
function findingLiterals(): FindingLiteral[] {
  const found: FindingLiteral[] = [];
  for (const dirName of SCANNED_DIRS) {
    for (const path of walk(join(REPO_ROOT, dirName))) {
      const file = relative(REPO_ROOT, path);
      if (file === SCHEMA_MODULE) continue;
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/["']?\bevidence_span["']?\s*:/g)) {
        const literal = enclosingObject(text, match.index ?? 0);
        if (literal === null) continue;
        const problems: string[] = [];
        if (!/["']?\bdescription["']?\s*[:,]/.test(literal)) problems.push("missing description");
        if (!/["']?\bsnippet["']?\s*[:,]/.test(literal)) problems.push("missing evidence_span.snippet");
        const disposition = /["']?\bdisposition["']?\s*:\s*["']([^"']*)["']/.exec(literal)?.[1];
        // A prompt template ("<${dispositionList()}>") is not a fixture value.
        const isTemplate = disposition?.includes("$") === true || disposition?.includes("<") === true;
        if (disposition !== undefined && !isTemplate && !(DISPOSITIONS as readonly string[]).includes(disposition)) {
          problems.push(`disposition "${disposition}" is not one of ${DISPOSITIONS.join("|")}`);
        }
        found.push({
          file,
          line: text.slice(0, match.index ?? 0).split("\n").length,
          conforms: problems.length === 0,
          problems,
        });
      }
    }
  }
  return found;
}

describe("INT-4: raw verdict fixtures follow the T4b contract", () => {
  const literals = findingLiterals();

  test("the scan sees the fixtures the merged teams wrote", () => {
    const files = new Set(literals.map((l) => l.file));
    for (const expected of [
      "tests/review-step-identity.test.ts",
      "tests/jev-wiring.test.ts",
      "tests/lane-b-gates.test.ts",
      "tests/flow-pure-derivations.test.ts",
      "tests/verdict-repair.test.ts",
    ]) {
      expect(files.has(expected), `scan no longer reaches ${expected}`).toBe(true);
    }
  });

  test("every finding literal outside the negative-test files carries description, snippet and a valid disposition", () => {
    const offenders = literals
      .filter((l) => !l.conforms && !NEGATIVE_TEST_FILES.has(l.file))
      .map((l) => `${l.file}:${l.line} ${l.problems.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  test("the negative-test files still contain conforming literals (positive case stays covered)", () => {
    for (const file of NEGATIVE_TEST_FILES) {
      if (file === "tests/verdict-fixture-contract.test.ts") continue;
      expect(
        literals.some((l) => l.file === file && l.conforms),
        `${file} has no conforming finding literal`,
      ).toBe(true);
    }
  });

  test("the detector itself: a finding without a description is flagged, with one it is not", () => {
    const legacy = {
      finding_id: "F1",
      severity: "major",
      evidence_span: { start_line: 1, end_line: 1, snippet: "x" },
      disposition: "fix",
    };
    expect(validateFinding(legacy).ok).toBe(false);
    expect(validateFinding({ ...legacy, description: "what is wrong" }).ok).toBe(true);
    expect(validateFinding({ ...legacy, description: "d", disposition: "later" }).ok).toBe(false);
    expect(validateFinding({ ...legacy, description: "d", evidence_span: { start_line: 1, end_line: 1 } }).ok).toBe(false);
  });
});
