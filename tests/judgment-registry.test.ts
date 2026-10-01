/**
 * AC-R: the judgment registry (src/judgment-registry.ts) is enforced, not
 * decorative. The registry header promises that an unregistered Lane-B
 * consumer is a review-blocking defect; these tests make that true:
 *
 * - every seamModule names files that exist;
 * - every call to a Lane-B seam constructor in production code sits in a
 *   module the matching registry entry lists (so a new consumer cannot ship
 *   unregistered, and an entry cannot keep pointing at a file that never
 *   held the seam — the old citation-check entry named src/metrics/agreement.ts,
 *   which has no citation code);
 * - the thresholds the registry states are the ones the code applies.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { citationKept } from "../flows/port-project.js";
import { DIFF_HEADER_LINES, mapVerdictToMetrics, parseUnifiedDiff } from "../src/harness/runtime.js";
import {
  CITATION_MIN_P_JEV,
  CITATION_MIN_P_NAIVE,
  JUDGMENT_REGISTRY,
  judgmentRegistryEntry,
} from "../src/judgment-registry.js";
import { DEFAULT_ESCALATION_THRESHOLD, selectSymbolType, type PhpSymbol } from "../src/typesafe/symbol-types.js";
import { createInMemoryJevClient, type InMemoryResponder } from "../src/typesafe/client.js";

import { REPO_ROOT } from "./support/paths.js";

/** Seam constructor -> the registry entry that must list every module calling it. */
const LANE_B_SEAMS: Readonly<Record<string, string>> = {
  createCitationChecker: "citation-check",
  createJevPrioritizer: "prioritize",
  selectSymbolType: "symbol-table-selection",
  createJevFailureClassifier: "vitest-triage",
};

/** Diagnostics that call a seam to REPORT on it; they route no content. */
const DIAGNOSTIC_CALLERS: ReadonlySet<string> = new Set(["scripts/jev-spot-check.ts"]);

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "fixtures" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listTs(abs));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

/** Drops // and block comments so prose that names a seam is not a call site. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function seamModulePaths(text: string): string[] {
  return [...text.matchAll(/\b(?:src|flows|scripts)\/[A-Za-z0-9_./-]+\.ts\b/g)].map((m) => m[0]);
}

describe("registry shape", () => {
  test("entry names are unique and every field is populated", () => {
    const names = JUDGMENT_REGISTRY.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of JUDGMENT_REGISTRY) {
      for (const field of ["judgment", "threshold", "effect", "provenance", "failOpen", "seamModule"] as const) {
        expect(entry[field].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("every Lane-B consumer the flow runs is registered", () => {
    const names = JUDGMENT_REGISTRY.map((e) => e.name);
    for (const required of [
      "vitest-triage",
      "citation-check",
      "prep-citation-check",
      "prioritize",
      "symbol-table-selection",
    ]) {
      expect(names).toContain(required);
    }
    for (const entryName of Object.values(LANE_B_SEAMS)) {
      expect(() => judgmentRegistryEntry(entryName)).not.toThrow();
    }
  });
});

describe("AC-R: seam modules exist", () => {
  test("every entry names at least one path and every named path exists", () => {
    for (const entry of JUDGMENT_REGISTRY) {
      const paths = seamModulePaths(entry.seamModule);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(existsSync(join(REPO_ROOT, path))).toBe(true);
      }
    }
  });

  test("the citation-check seam is the module that actually holds citation code", () => {
    const entry = judgmentRegistryEntry("citation-check");
    const seam = seamModulePaths(entry.seamModule);
    expect(seam).toContain("src/typesafe/verdict-check.ts");
    const source = readFileSync(join(REPO_ROOT, "src/typesafe/verdict-check.ts"), "utf8");
    expect(source).toContain("p_cited");
    // The path the audit found wrong: agreement.ts has no citation/p_cited code.
    expect(seam).not.toContain("src/metrics/agreement.ts");
  });
});

/** Files (by repo-relative path) whose code calls `seam(` — comments and declarations excluded. */
function seamCallers(seam: string, sources: Readonly<Record<string, string>>): string[] {
  const callPattern = new RegExp(`(?<!function\\s)\\b${seam}\\(`);
  return Object.entries(sources)
    .filter(([, source]) => callPattern.test(stripComments(source)))
    .map(([path]) => path);
}

/** Callers of `seam` that the registry entry does not list (diagnostic scripts excepted). */
function unregisteredCallers(seam: string, entryName: string, sources: Readonly<Record<string, string>>): string[] {
  const listed = new Set(seamModulePaths(judgmentRegistryEntry(entryName).seamModule));
  return seamCallers(seam, sources).filter((path) => !DIAGNOSTIC_CALLERS.has(path) && !listed.has(path));
}

describe("AC-R: Lane-B seam construction only in registry-listed modules", () => {
  const productionSources: Record<string, string> = Object.fromEntries(
    ["flows", "src", "scripts"]
      .flatMap((d) => listTs(join(REPO_ROOT, d)))
      .map((abs) => [relative(REPO_ROOT, abs), readFileSync(abs, "utf8")]),
  );

  for (const [seam, entryName] of Object.entries(LANE_B_SEAMS)) {
    test(`${seam}( is called only from modules listed by "${entryName}"`, () => {
      // The flow really consumes every seam (an entry for an unused seam would be stale).
      expect(seamCallers(seam, productionSources).some((path) => path.startsWith("flows/port/"))).toBe(true);
      expect(unregisteredCallers(seam, entryName, productionSources)).toEqual([]);
    });
  }

  test("the scan itself can fail: an unregistered consumer module is reported", () => {
    const withRogue = {
      ...productionSources,
      "src/rogue-consumer.ts": "export const x = createJevPrioritizer(client);\n",
    };
    expect(unregisteredCallers("createJevPrioritizer", "prioritize", withRogue)).toEqual(["src/rogue-consumer.ts"]);
    // Prose and declarations are not call sites.
    const prose = {
      "src/notes.ts": "// createJevPrioritizer(client) is described here\n/* selectSymbolType( also */\n",
      "src/decl.ts": "export function selectSymbolType(client: unknown): void {}\n",
    };
    expect(seamCallers("createJevPrioritizer", prose)).toEqual([]);
    expect(seamCallers("selectSymbolType", prose)).toEqual([]);
  });
});

describe("registry thresholds are the thresholds the code applies", () => {
  test("citation-check states both keep thresholds, derived from the exported constants", () => {
    const { threshold } = judgmentRegistryEntry("citation-check");
    expect(threshold).toContain(`p_cited < ${CITATION_MIN_P_NAIVE} drops`);
    expect(threshold).toContain(`p_cited < ${CITATION_MIN_P_JEV} drops`);
    // ...and the gate really applies them (boundary behaviour).
    expect(citationKept(CITATION_MIN_P_NAIVE, "naive")).toBe(true);
    expect(citationKept(CITATION_MIN_P_NAIVE - 0.01, "naive")).toBe(false);
    expect(citationKept(CITATION_MIN_P_JEV, "jev")).toBe(true);
    expect(citationKept(CITATION_MIN_P_JEV - 0.01, "jev")).toBe(false);
  });

  test("prep-citation-check uses the naive threshold only", () => {
    const { threshold, judgment } = judgmentRegistryEntry("prep-citation-check");
    expect(threshold).toContain(`p_cited < ${CITATION_MIN_P_NAIVE} drops`);
    expect(judgment).toContain("none");
  });

  test("symbol-table-selection states the escalation threshold and the choice-confidence floor selectSymbolType applies", async () => {
    const { threshold } = judgmentRegistryEntry("symbol-table-selection");
    const symbol: PhpSymbol = {
      name: "countItems",
      kind: "function",
      file: "src/Util/Counter.php",
      signature: "function countItems(array $items, ?int $limit = 10): int",
      docblock: "/**\n * @param {array} $items\n * @return int\n */",
      literal_usages: ["42"],
    };
    // Low choice confidence + one failing verification noul: both fixed
    // thresholds show up on the escalation records the code produces.
    const responder: InMemoryResponder = (request) => {
      if ("type_selection" in request.questions) {
        return { type_selection: { type: "choice", choice: "number", confidence: 0.6, probabilities: { number: 0.6 } } };
      }
      return {
        type_mismatch: { type: "noul", noul: 0.95 },
        hallucinated: { type: "noul", noul: 0.95 },
        unreasonable: { type: "noul", noul: 0.1 },
        absence_wrong: { type: "noul", noul: 0.95 },
      };
    };
    const decision = await selectSymbolType(createInMemoryJevClient(responder), symbol);
    const thresholds = new Map(decision.escalations.map((e) => [e.check, e.threshold]));
    expect(thresholds.get("unreasonable")).toBe(DEFAULT_ESCALATION_THRESHOLD);
    expect(threshold).toContain(String(DEFAULT_ESCALATION_THRESHOLD));
    const floor = thresholds.get("uncertain_band");
    expect(floor).toBe(0.9);
    expect(threshold).toContain(String(floor));
  });

  test("C17: citation-check provenance says what the code records, not what it used to", () => {
    const { provenance } = judgmentRegistryEntry("citation-check");
    // Where the gate's own score lives, and what the verdict records carry instead.
    expect(provenance).toContain("pp-kept");
    expect(provenance).toContain("citationGate");
    expect(provenance).toContain("deterministic check stamped at review time");
    // The clause that stopped being true: the verdict record is NOT the reviewer's self-report.
    expect(provenance).not.toContain("carry only the reviewer's self-reported p_cited");
    expect(provenance).toContain("self-reported p_cited stays on the agent record, advisory");

    // ...and the code behaves as the entry now says: the mapped verdict record holds the deterministic
    // score, the model's 0.9 survives only on the agent record.
    const diff = "diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;";
    const mapped = mapVerdictToMetrics({
      raw: {
        findings: [
          {
            finding_id: "F1",
            severity: "minor",
            description: "x",
            evidence_span: { start_line: 1, end_line: 1, snippet: "export const a = 1;" },
            disposition: "fix",
          },
        ],
        citation_check: [{ finding_id: "F1", p_cited: 0.9 }],
      },
      file: "src/a.ts",
      reviewer: "reviewer-A",
      round: 1,
      diffId: "d1",
      parsedDiff: parseUnifiedDiff(diff),
      bodyLineOffset: DIFF_HEADER_LINES,
      naiveCited: () => 0.42,
    });
    if (!mapped.ok) throw new Error(mapped.errors.join("; "));
    expect(mapped.record.citation_check[0]?.p_cited).toBe(0.42);
    expect(mapped.agentRecord.citation_check[0]?.p_cited).toBe(0.9);
  });

  test("symbol-table-selection is declared NOT fail-open (the header rule names the exception)", () => {
    expect(judgmentRegistryEntry("symbol-table-selection").failOpen.startsWith("NONE")).toBe(true);
    for (const entry of JUDGMENT_REGISTRY) {
      if (entry.name === "symbol-table-selection") continue;
      expect(entry.failOpen.startsWith("NONE")).toBe(false);
    }
  });
});
