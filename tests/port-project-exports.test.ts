/**
 * C91: flows/port-project.ts is the PUBLIC ENTRY of the port flows; the code
 * lives in flows/port/*.ts. This file pins what that split must not change:
 *
 * 1. the export surface of the entry (runtime values AND type-only names), so
 *    a module move can neither drop a name callers import nor leak an internal
 *    one into the public surface;
 * 2. the module graph under flows/: no import cycle (the step graph itself is
 *    cyclic, so the one back-edge is late-bound through flows/port/links.ts),
 *    and the leaf modules never import a step or flow module;
 * 3. the static goTo() topology of the step classes;
 * 4. facts that depend on a module's directory depth or load order.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { AttributeMap } from "@superdurable/dex";
import ts from "typescript";

import * as entry from "../flows/port-project.js";
import { releaseStepLink } from "../flows/port/links.js";
import { PORT_FLOW_ENTRY } from "./helpers/port-flow-source.js";

const ROOT = join(import.meta.dir, "..");
const ENTRY = PORT_FLOW_ENTRY;

/** Runtime exports of flows/port-project.ts (sorted with the default string order). */
const VALUE_EXPORTS: readonly string[] = [
  "BOOTSTRAP_OP_ID",
  "BOOTSTRAP_VITEST_PIN",
  "LEASE_SLOT_CAP",
  "PortFileFlow",
  "PortFileFlowInstance",
  "PortProjectFlow",
  "REVIEW_STEP_MAX_ATTEMPTS",
  "bootstrapPlan",
  "citationKept",
  "classifyVitestRecords",
  "composeAgentTurn",
  "configurePortHarness",
  "deriveNext",
  "diffKeyOf",
  "errorCountsByOutput",
  "findVitestTestFiles",
  "keptKeyOf",
  "liveJevClient",
  "markerKeyOf",
  "outKeyOf",
  "parsePrepSourceMap",
  "portPersistenceSchema",
  "portedRootsFromSourceMap",
  "ppBootstrap",
  "ppBurndown",
  "ppConfig",
  "ppDiff",
  "ppJevUsage",
  "ppKept",
  "ppLease",
  "ppMarker",
  "ppOut",
  "ppPrep",
  "ppPrepDiff",
  "ppPrepDraft",
  "ppPrepFindings",
  "ppPrepSeed",
  "ppPrepState",
  "ppPrepVerdict",
  "ppQueue",
  "ppSymtab",
  "ppVerdict",
  "ppVerify",
  "ppWave",
  "ppWaveChildren",
  "queueFixFeedForFile",
  "queueVerifyTools",
  "resetInStepVerdictMemo",
  "runAgentTurn",
  "runCitationGate",
  "runIntegrationBootstrap",
  "runPrioritizeGate",
  "runReviewTurn",
  "scaffoldTsconfigText",
  "selectFixableFiles",
  "tsconfigIncludeFromSourceMap",
  "verdictKeyOf",
  "vitestOutcomeFromRun",
  "vitestRoutedTo",
  "waveEntryRound",
];

/** Type-only exports of flows/port-project.ts (interfaces and aliases; erased at runtime). */
const TYPE_EXPORTS: readonly string[] = [
  "BootstrapDeps",
  "BootstrapInspection",
  "BootstrapOutcome",
  "BootstrapPlan",
  "BootstrapRecord",
  "CapturedDiff",
  "ChildFileResult",
  "CitationGateRecord",
  "Context",
  "FileRoundInput",
  "JevGateResult",
  "JudgmentChecker",
  "KeptFindings",
  "LeaseOutcome",
  "NextAction",
  "OutPathRef",
  "PortFileInput",
  "PortQueueState",
  "PortRunConfig",
  "PortRunInput",
  "PortRunResult",
  "PrepArtifact",
  "PrepDiffArtifact",
  "PrepDraft",
  "PrepSeedState",
  "QueueBurnDownSample",
  "QueueVerifyError",
  "QueueVerifyState",
  "ReviewTuple",
  "ReviewTurnDiff",
  "ReviewVerdict",
  "StepDecision",
  "SymbolTableRow",
  "TscRunAccounting",
  "VitestTriageRecord",
  "WaveChildrenRecord",
  "WaveDispatchOutput",
  "WaveDispatchRecord",
  "WaveEntry",
  "WaveMode",
];

describe("flows/port-project.ts public export surface", () => {
  test("runtime exports are exactly the pinned list", () => {
    expect(Object.keys(entry).sort()).toEqual([...VALUE_EXPORTS].sort());
  });

  test("the module's full export set (values AND types) is exactly the pinned lists", () => {
    const config = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT).options;
    const program = ts.createProgram([join(ROOT, ENTRY)], { ...options, noEmit: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(join(ROOT, ENTRY));
    if (source === undefined) throw new Error(`${ENTRY} is not part of the program`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) throw new Error(`${ENTRY} is not a module`);

    const typeOnly: string[] = [];
    const values: string[] = [];
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      (target.flags & ts.SymbolFlags.Value ? values : typeOnly).push(symbol.name);
    }
    expect(values.sort()).toEqual([...VALUE_EXPORTS].sort());
    expect(typeOnly.sort()).toEqual([...TYPE_EXPORTS].sort());
  });

  test("every exported durable attribute is registered by both flows' persistence schema", () => {
    const attributes = Object.entries(entry).filter(([, value]) => value instanceof AttributeMap);
    expect(attributes.length).toBe(22);
    const projectSchema = new entry.PortProjectFlow().getPersistenceSchema().attributes as unknown[];
    const fileSchema = new entry.PortFileFlow().getPersistenceSchema().attributes as unknown[];
    expect(entry.portPersistenceSchema().attributes as unknown[]).toEqual(projectSchema);
    for (const [name, attribute] of attributes) {
      expect(projectSchema, `${name} missing from port.Project's schema`).toContain(attribute);
      expect(fileSchema, `${name} missing from port.File's schema`).toContain(attribute);
    }
  });
});

describe("flows/port module graph", () => {
  const SPECIFIER = /^(import|export)\s+(type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm;

  function tsFiles(dir: string): string[] {
    return readdirSync(join(ROOT, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) return tsFiles(rel);
      return name.endsWith(".ts") ? [rel] : [];
    });
  }

  /** Runtime (non-`import type`) relative imports that stay inside flows/, repo-relative. */
  function runtimeImports(rel: string): string[] {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const out: string[] = [];
    for (const match of text.matchAll(SPECIFIER)) {
      if (match[2] !== undefined) continue; // `import type` / `export type`: erased
      const specifier = match[3] ?? match[4];
      if (specifier === undefined || !specifier.startsWith(".")) continue;
      const target = relative(ROOT, resolve(dirname(join(ROOT, rel)), specifier.replace(/\.js$/, ".ts")));
      if (target.startsWith("flows/")) out.push(target);
    }
    return out;
  }

  const files = tsFiles("flows");
  const graph = new Map(files.map((rel) => [rel, runtimeImports(rel)]));

  test("the scan sees the modules it is meant to police", () => {
    expect(files).toContain(ENTRY);
    expect(files).toContain("flows/port/links.ts");
    expect(files.filter((rel) => rel.startsWith("flows/port/")).length).toBeGreaterThanOrEqual(14);
    expect(graph.get("flows/port/project-steps.ts")).toContain("flows/port/file-steps.ts");
  });

  /** First cycle found by DFS, as a path of files, or null. */
  function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | null {
    const state = new Map<string, "visiting" | "done">();
    const stack: string[] = [];
    const visit = (node: string): string[] | null => {
      if (state.get(node) === "done") return null;
      if (state.get(node) === "visiting") return [...stack.slice(stack.indexOf(node)), node];
      state.set(node, "visiting");
      stack.push(node);
      for (const next of edges.get(node) ?? []) {
        const cycle = visit(next);
        if (cycle !== null) return cycle;
      }
      stack.pop();
      state.set(node, "done");
      return null;
    };
    for (const node of edges.keys()) {
      const cycle = visit(node);
      if (cycle !== null) return cycle;
    }
    return null;
  }

  test("the runtime import graph under flows/ has no cycle", () => {
    expect(findCycle(graph)).toBeNull();
  });

  test("the cycle finder finds a cycle when there is one", () => {
    const cyclic = new Map<string, string[]>([
      ["a.ts", ["b.ts"]],
      ["b.ts", ["c.ts"]],
      ["c.ts", ["a.ts"]],
    ]);
    expect(findCycle(cyclic)).toEqual(["a.ts", "b.ts", "c.ts", "a.ts"]);
  });

  test("leaf modules never import a step, flow or entry module", () => {
    const leaves = [
      "state",
      "queue-logic",
      "leases",
      "lane-b",
      "agent-turns",
      "review-turn",
      "queue-tools",
      "bootstrap",
      "step-options",
      "links",
    ];
    const upper = new Set([
      ENTRY,
      ...["file-steps", "file-flow", "project-steps", "prep-steps", "project-flow"].map((name) => `flows/port/${name}.ts`),
    ]);
    for (const leaf of leaves) {
      const imports = graph.get(`flows/port/${leaf}.ts`);
      expect(imports, `flows/port/${leaf}.ts exists`).toBeDefined();
      expect((imports ?? []).filter((target) => upper.has(target)), `${leaf} imports upward`).toEqual([]);
    }
  });

  test("the entry module holds no code: only (type) re-exports", () => {
    const code = readFileSync(join(ROOT, ENTRY), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/(?:export\s+(?:type\s+)?\{[^}]*\}\s*from\s*"[^"]+";)/g, "")
      .trim();
    expect(code).toBe("");
  });
});

describe("step graph topology (static goTo() edges)", () => {
  /** step constant -> sorted, de-duplicated goTo() target class names. */
  function routeGraph(rels: readonly string[]): Record<string, string[]> {
    const edges: Record<string, Set<string>> = {};
    for (const rel of rels) {
      let current: string | null = null;
      for (const line of readFileSync(join(ROOT, rel), "utf8").split("\n")) {
        const declaration = /^(?:export )?const (\w+)\s*:\s*EnvelopeStepClass</.exec(line);
        if (declaration !== null) {
          current = declaration[1] ?? null;
          if (current !== null) edges[current] ??= new Set();
          continue;
        }
        if (/^(?:export )?(?:const|function|class|interface|type|async function) /.test(line)) current = null;
        if (current === null) continue;
        for (const call of line.matchAll(/\bgoTo\((\w+)/g)) {
          // The one late-bound edge reads its target through the link.
          const target = call[1] === "releaseStepLink" ? "ReleaseStep" : call[1];
          if (target !== undefined) edges[current]?.add(target);
        }
      }
    }
    return Object.fromEntries(
      Object.entries(edges)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([step, targets]) => [step, [...targets].sort()]),
    );
  }

  test("the step classes route exactly as before the split", () => {
    expect(routeGraph(["flows/port/prep-steps.ts", "flows/port/file-steps.ts", "flows/port/project-steps.ts"])).toEqual({
      BootstrapStep: ["DispatchStep"],
      CaptureDiffStep: ["ReviewAStart"],
      ChildLeaseStep: ["FenceStep"],
      ChildReleaseStep: [],
      CommitStep: ["ChildReleaseStep", "IntegrateStep"],
      DispatchStep: ["DispatchStep", "LeaseStep", "QueueVerifyStep", "WaveDispatchStep"],
      FenceStep: ["ImplementStart", "QueueFixStart"],
      FinalStep: [],
      FixerStart: ["FixerStep"],
      FixerStep: ["CommitStep"],
      ImplementStart: ["ImplementStep"],
      ImplementStep: ["CaptureDiffStep"],
      IntegrateStep: ["ReleaseStep"],
      LeaseStep: ["FenceStep", "FinalStep"],
      PrepDiffCaptureStep: ["PrepReviewAStart"],
      PrepFinalizeStep: ["DispatchStep"],
      PrepGenerateStep: ["PrepDiffCaptureStep"],
      PrepLoopDecisionStep: ["PrepFinalizeStep", "PrepReviseStart"],
      PrepReviewAStart: ["PrepReviewAStep"],
      PrepReviewAStep: ["PrepReviewBStart"],
      PrepReviewBStart: ["PrepReviewBStep"],
      PrepReviewBStep: ["PrepVerdictCheckStep"],
      PrepReviseStart: ["PrepReviseStep"],
      PrepReviseStep: ["PrepDiffCaptureStep"],
      PrepStart: ["PrepGenerateStep"],
      PrepStep: ["SymbolStart"],
      PrepVerdictCheckStep: ["PrepLoopDecisionStep"],
      PrioritizeStep: ["FixerStart"],
      QueueFixStart: ["QueueFixStep"],
      QueueFixStep: ["CaptureDiffStep"],
      QueueVerifyStep: ["FinalStep", "LeaseStep", "WaveDispatchStep"],
      ReleaseStep: ["BootstrapStep"],
      ReviewAStart: ["ReviewAStep"],
      ReviewAStep: ["ReviewBStart"],
      ReviewBStart: ["ReviewBStep"],
      ReviewBStep: ["VerdictCheckStep"],
      SymbolStart: ["SymbolTableStep"],
      SymbolTableStep: ["PrepStart"],
      VerdictCheckStep: ["CommitStep", "PrioritizeStep"],
      WaveDispatchStep: ["WaveJoinStep"],
      WaveJoinStep: ["BootstrapStep", "QueueVerifyStep"],
    });
  });

  test("the late-bound ReleaseStep link resolves to the class port.Project registers", () => {
    expect(releaseStepLink.get() as unknown).toBe(new entry.PortProjectFlow().release.constructor);
  });
});

describe("depth- and order-sensitive facts", () => {
  test("queueVerifyTools.tscBin still points at the repo's node_modules/.bin/tsc", () => {
    expect(entry.queueVerifyTools.tscBin).toBe(join(ROOT, "node_modules", ".bin", "tsc"));
  });
});
