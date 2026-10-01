/**
 * INT-11 — the verdict-key sanitizer has ONE inverse.
 *
 * Verdict attributes are keyed `<sanitizeFileKey(file)>#<round>#<reviewer>`,
 * and "/" -> "__" is lossy in reverse for a file whose own name contains "__".
 * T5 centralised the inverse as fileFromSanitizedKey (src/metrics/types.ts);
 * T6's dashboard kept a private copy in parseVerdictKeySuffix. Two copies of a
 * lossy function drift in exactly the cases nobody tests, so the dashboard now
 * imports the shared one. This pins that, and that the report's tombstone
 * collector and the dashboard's degraded-round view name the same file for the
 * same key, ordinary or lossy.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { degradedRoundsOf } from "../src/dashboard/state.js";
import { collectTombstones, type StateAttribute } from "../src/metrics/collect.js";
import { fileFromSanitizedKey, sanitizeFileKey } from "../src/metrics/types.js";

import { REPO_ROOT } from "./support/paths.js";

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function tombstone(reviewer: string): Record<string, unknown> {
  return { reviewer, discarded: true, reason: "discarded after repair", attempt: 3, tokens: 100 };
}

/** Two discarded reviewers and no completed record: the round the dashboard marks DEGRADED. */
function degradedAttributes(file: string, round: number): StateAttribute[] {
  const key = `${sanitizeFileKey(file)}#${round}`;
  return [
    { key: `pp-verdict/${key}#reviewer-A`, value: tombstone("reviewer-A") },
    { key: `pp-verdict/${key}#reviewer-B`, value: tombstone("reviewer-B") },
  ];
}

describe("INT-11: one inverse of the verdict-key sanitizer", () => {
  test("the dashboard imports fileFromSanitizedKey and keeps no private `__` -> `/` copy", () => {
    const state = readFileSync(join(REPO_ROOT, "src", "dashboard", "state.ts"), "utf8");
    expect(state).toMatch(/import \{ fileFromSanitizedKey \} from "\.\.\/metrics\/types\.js"/);
    expect(state).toContain("fileFromSanitizedKey(");
    // across all non-test sources, the inverse is spelled exactly once: in the shared helper
    const copies = [...sources(join(REPO_ROOT, "src")), ...sources(join(REPO_ROOT, "scripts")), ...sources(join(REPO_ROOT, "flows"))]
      .filter((path) => /\.replace\(\s*\/__\/g\s*,\s*["']\/["']\s*\)/.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));
    expect(copies).toEqual(["src/metrics/types.ts"]);
  });

  test("the shared pair round-trips ordinary paths and is documented as lossy for `__` names", () => {
    expect(fileFromSanitizedKey(sanitizeFileKey("src/Auth/LdapAuth.php"))).toBe("src/Auth/LdapAuth.php");
    expect(fileFromSanitizedKey(sanitizeFileKey("src/__tests__/Foo.php"))).not.toBe("src/__tests__/Foo.php");
  });

  for (const [label, file] of [
    ["an ordinary path", "src/Auth/LdapAuth.php"],
    ["a path whose own name contains `__` (lossy inverse)", "src/__tests__/Foo.php"],
  ] as const) {
    test(`${label}: the dashboard's degraded round and the report's tombstones agree on the file`, () => {
      const attributes = degradedAttributes(file, 2);

      const fromReport = collectTombstones(attributes);
      expect(fromReport).toHaveLength(2);
      const reportFile = fromReport[0]?.file;
      expect(fromReport.every((t) => t.file === reportFile && t.round === 2)).toBe(true);

      const rounds = degradedRoundsOf("flow-1", { attributes } as never);
      expect(rounds).toHaveLength(1);
      expect(rounds[0]?.round).toBe(2);
      expect(rounds[0]?.file).toBe(reportFile ?? "");
      expect(rounds[0]?.file).toBe(fileFromSanitizedKey(sanitizeFileKey(file)));
    });
  }
});
