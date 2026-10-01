/**
 * Drift guards for facts the code keeps in more than one place.
 *
 * The metrics layer and the dashboard must not import the flows (that would
 * pull the dex SDK into the renderer and the page), so a few facts about the
 * flow are mirrored by hand. Where a copy could be removed it was: one home for
 * the envelope types and model-calling roles (src/metrics/types.ts), the token
 * total (tokenTotalOf), and the file-key sanitizer (src/file-keys.ts). What
 * remains is pinned here against the real thing, so a rename or an added step
 * fails a test instead of quietly skewing a report.
 */

import { describe, expect, test } from "bun:test";

import {
  PortFileFlow,
  PortProjectFlow,
  diffKeyOf,
  keptKeyOf,
  markerKeyOf,
  outKeyOf,
  tsconfigIncludeFromSourceMap,
  verdictKeyOf,
} from "../flows/port-project.js";
import {
  BOOTSTRAP_TEST_GLOBS,
  BOOTSTRAP_TSCONFIG,
  bootstrapVitestConfig,
  scaffoldTsconfigText,
} from "../flows/port/bootstrap.js";
import {
  envelopeStepIdentityOf,
  registeredSteps,
  requiresTokens,
  type EnvelopeEvent as FlowEnvelopeEvent,
  type EnvelopeOutcome as FlowEnvelopeOutcome,
  type EnvelopeRole as FlowEnvelopeRole,
  type EnvelopeStreamMessage,
} from "../flows/steps/envelope.js";
import { REVIEW_STEP_TYPES } from "../scripts/dispatch-gate.js";
import { markerKey } from "../scripts/probe-flow.js";
import { parseEnvelope, normalizeTokens } from "../src/dashboard/state.js";
import type {
  StreamEventMessage,
  TscAccountingSample,
  VitestAccountingSample,
} from "../src/dashboard/types.js";
import { fileFromIdentity, fileFromSanitizedKey, identityKeyOf, sanitizeFileKey } from "../src/file-keys.js";
import { fenceLabel, parseFenceLabel, tokenTotal } from "../src/harness/opencode.js";
import { toEnvelopeUsage } from "../src/harness/runtime.js";
import { PORT_FLOW_STEPS } from "../src/metrics/dispatch-anchor.js";
import { FIXER_STEP_ID } from "../src/metrics/render.js";
import {
  MODEL_CALLING_ROLES,
  isModelCallingRole,
  tokenTotalOf,
  type EnvelopeEvent,
  type EnvelopeOutcome,
  type EnvelopeRole,
  type TscRunAccounting,
  type VitestRunAccounting,
} from "../src/metrics/types.js";
import { productionSources, readSource } from "./support/source-files.js";

// ---------------------------------------------------------------------------
// The step table (src/metrics/dispatch-anchor.ts) against the real flows
// ---------------------------------------------------------------------------

const projectSteps = registeredSteps(new PortProjectFlow());
const fileSteps = registeredSteps(new PortFileFlow());
const realByType = new Map([...fileSteps, ...projectSteps]);
const tableByType = new Map(PORT_FLOW_STEPS.map((row) => [row.stepType, row]));

describe("PORT_FLOW_STEPS mirrors the real step classes of port.Project and port.File", () => {
  test("the scan reaches both flows", () => {
    expect(projectSteps.size).toBeGreaterThan(30);
    expect(fileSteps.size).toBeGreaterThan(10);
  });

  test("every registered step was made by the envelope factory (so it has an identity to compare)", () => {
    const unidentified = [...realByType].filter(([, identity]) => identity === undefined).map(([type]) => type);
    expect(unidentified).toEqual([]);
  });

  test("a step type registered in both flows is the same step (stepId, role, marker)", () => {
    const disagree = [...fileSteps]
      .filter(([type, identity]) => projectSteps.has(type) && JSON.stringify(projectSteps.get(type)) !== JSON.stringify(identity))
      .map(([type]) => type);
    expect(disagree).toEqual([]);
  });

  test("no step type is missing from the table, and the table holds no step the flows lack", () => {
    const inFlowsOnly = [...realByType.keys()].filter((type) => !tableByType.has(type)).sort();
    const inTableOnly = [...tableByType.keys()].filter((type) => !realByType.has(type)).sort();
    expect({ inFlowsOnly, inTableOnly }).toEqual({ inFlowsOnly: [], inTableOnly: [] });
    expect(tableByType.size).toBe(PORT_FLOW_STEPS.length);
  });

  test("each row's stepId, role and marker kind equal the real step's", () => {
    const wrong: string[] = [];
    for (const row of PORT_FLOW_STEPS) {
      const real = realByType.get(row.stepType);
      if (real === undefined) continue; // reported by the test above
      if (real.stepId !== row.stepId) wrong.push(`${row.stepType}: stepId ${row.stepId} != ${real.stepId}`);
      if (real.role !== row.role) wrong.push(`${row.stepType}: role ${row.role} != ${real.role}`);
      if (real.marker !== (row.kind === "marker")) wrong.push(`${row.stepType}: kind ${row.kind} but marker=${String(real.marker)}`);
    }
    expect(wrong).toEqual([]);
  });

  test("kind follows from the real step: markers are start markers, model steps are the model-calling roles, the rest are support", () => {
    const wrong: string[] = [];
    for (const row of PORT_FLOW_STEPS) {
      const expected = realByType.get(row.stepType)?.marker === true ? "marker" : requiresTokens(row.role) ? "model" : "support";
      if (row.kind !== expected) wrong.push(`${row.stepType}: kind ${row.kind}, the flow says ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  test("a marker row names its target's envelope: selfStepId is `<stepId>:start`, and a model step with that stepId exists", () => {
    const wrong: string[] = [];
    for (const row of PORT_FLOW_STEPS) {
      if (row.kind !== "marker") {
        if (row.selfStepId !== undefined) wrong.push(`${row.stepType}: selfStepId on a ${row.kind} step`);
        continue;
      }
      if (row.selfStepId !== `${row.stepId}:start`) wrong.push(`${row.stepType}: selfStepId ${String(row.selfStepId)}`);
      const target = PORT_FLOW_STEPS.find((r) => r.kind === "model" && r.stepId === row.stepId && r.role === row.role);
      if (target === undefined) wrong.push(`${row.stepType}: no model step ${row.stepId} (${row.role}) follows it`);
    }
    expect(wrong).toEqual([]);
  });

  test("REVIEW_STEP_TYPES is the real review-role model steps (prep and per-file, A and B)", () => {
    const real = [...realByType]
      .filter(([, identity]) => identity?.role === "review" && identity.marker === false)
      .map(([type]) => type)
      .sort();
    expect([...REVIEW_STEP_TYPES].sort()).toEqual(real);
    expect(real).toEqual(["PpPrepReviewA", "PpPrepReviewB", "PpReviewA", "PpReviewB"]);
  });

  test("the renderer's FIXER_STEP_ID is the real fixer step's id", () => {
    expect(envelopeStepIdentityOf(new PortProjectFlow().fixer)?.stepId).toBe(FIXER_STEP_ID);
  });
});

// ---------------------------------------------------------------------------
// The envelope contract: one definition, and the classifications that hang off it
// ---------------------------------------------------------------------------

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Compile-time guards: tsc fails here if the flow's types and the metrics
// layer's ever diverge, or the dashboard's structural mirrors fall out of step.
const sameRole: Same<FlowEnvelopeRole, EnvelopeRole> = true;
const sameOutcome: Same<FlowEnvelopeOutcome, EnvelopeOutcome> = true;
const sameEvent: Same<FlowEnvelopeEvent, EnvelopeEvent> = true;
const streamMessageMirrored: Same<keyof EnvelopeStreamMessage, keyof StreamEventMessage> = true;
const streamMessageAssignable: EnvelopeStreamMessage extends StreamEventMessage ? true : false = true;
const tscAccountingMirrored: Same<keyof TscRunAccounting, keyof TscAccountingSample> = true;
const tscAccountingAssignable: TscRunAccounting extends TscAccountingSample ? true : false = true;
const vitestAccountingMirrored: Same<keyof VitestRunAccounting, keyof VitestAccountingSample> = true;
const vitestAccountingAssignable: VitestRunAccounting extends VitestAccountingSample ? true : false = true;

/** Adding a role breaks compilation here until it is classified. */
const ROLE_CALLS_A_MODEL: Record<EnvelopeRole, boolean> = {
  agent: true,
  review: true,
  judgment: true,
  "verdict-check": false,
  prioritize: false,
  commit: false,
  integration: false,
  queue: false,
  "diff-capture": false,
  record: false,
};
const ALL_ROLES = Object.keys(ROLE_CALLS_A_MODEL) as EnvelopeRole[];

describe("envelope contract", () => {
  test("the flow's envelope types are the metrics layer's, and the dashboard's mirrors keep their shape", () => {
    expect([
      sameRole,
      sameOutcome,
      sameEvent,
      streamMessageMirrored,
      streamMessageAssignable,
      tscAccountingMirrored,
      tscAccountingAssignable,
      vitestAccountingMirrored,
      vitestAccountingAssignable,
    ]).toEqual(Array(9).fill(true));
  });

  test("the types and the role list are defined once, in src/metrics/types.ts", () => {
    const sites = (pattern: RegExp): string[] =>
      productionSources("src", "flows", "scripts", "harness").filter((rel) => pattern.test(readSource(rel)));
    expect(sites(/\btype EnvelopeRole\s*=/)).toEqual(["src/metrics/types.ts"]);
    expect(sites(/\btype EnvelopeOutcome\s*=/)).toEqual(["src/metrics/types.ts"]);
    expect(sites(/\binterface EnvelopeEvent\b/)).toEqual(["src/metrics/types.ts"]);
    expect(sites(/\bMODEL_CALLING_ROLES\s*[:=]/)).toEqual(["src/metrics/types.ts"]);
    expect(sites(/["']agent["']\s*,\s*["']review["']\s*,\s*["']judgment["']/)).toEqual(["src/metrics/types.ts"]);
  });

  test("MODEL_CALLING_ROLES is exactly the roles classified as model-calling", () => {
    const modelRoles: string[] = [...MODEL_CALLING_ROLES].sort();
    expect(modelRoles).toEqual(ALL_ROLES.filter((role) => ROLE_CALLS_A_MODEL[role]).sort());
    expect(modelRoles).toEqual(["agent", "judgment", "review"]);
  });

  test("the flow (requiresTokens), the renderer (isModelCallingRole) and the dashboard (tokensRequired) agree on every role", () => {
    for (const role of ALL_ROLES) {
      const row = { stepId: "s", role, attempt: 1, started_at: "2026-09-27T00:00:00Z" };
      expect([role, requiresTokens(role)]).toEqual([role, ROLE_CALLS_A_MODEL[role]]);
      expect([role, isModelCallingRole(role)]).toEqual([role, ROLE_CALLS_A_MODEL[role]]);
      expect([role, parseEnvelope(row)?.tokensRequired]).toEqual([role, ROLE_CALLS_A_MODEL[role]]);
      // an attempt-0 start marker never requires tokens, whatever its role
      expect(parseEnvelope({ ...row, attempt: 0 })?.tokensRequired).toBe(false);
    }
  });

  test("every role the step table uses is a known role", () => {
    for (const row of PORT_FLOW_STEPS) expect(ALL_ROLES).toContain(row.role);
  });
});

// ---------------------------------------------------------------------------
// Token totals: harness seam, metrics contract, dashboard
// ---------------------------------------------------------------------------

describe("token totals", () => {
  const USAGES = [
    { input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 4, cost: 0.01 },
    { input: 329_000, output: 4_000, reasoning: 0, cacheRead: 576_000, cacheWrite: 0, cost: 0 },
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 7, cost: 1.5 },
  ];

  test("the harness total, the metrics total and the dashboard total of one usage are the same number", () => {
    for (const usage of USAGES) {
      const split = toEnvelopeUsage(usage);
      const expected = tokenTotal(usage);
      expect(tokenTotalOf(split)).toBe(expected);
      expect(normalizeTokens(split)).toBe(expected);
      // and across the JSON round trip the durable attribute makes
      expect(tokenTotalOf(JSON.parse(JSON.stringify(split)))).toBe(expected);
      expect(normalizeTokens(JSON.parse(JSON.stringify(split)))).toBe(expected);
    }
  });

  test("a bare number passes through, and the metrics and dashboard normalizers agree on every shape", () => {
    const shapes: unknown[] = [
      42,
      0,
      null,
      undefined,
      "7",
      [],
      {},
      { input_tokens: 3 },
      { output_tokens: 3 },
      { input_tokens: "3", output_tokens: 4 },
      { input_tokens: 3, output_tokens: 4 },
      { input_tokens: 3, output_tokens: 4, reasoning_tokens: 5, cache_read_tokens: 6, cache_write_tokens: 7, cost_usd: 9 },
      // an optional split field that is not a finite number counts as 0
      { input_tokens: 3, output_tokens: 4, reasoning_tokens: "5", cache_read_tokens: Number.NaN, cache_write_tokens: Number.POSITIVE_INFINITY },
    ];
    for (const shape of shapes) expect([shape, normalizeTokens(shape)]).toEqual([shape, tokenTotalOf(shape)]);
    expect(tokenTotalOf(42)).toBe(42);
    expect(tokenTotalOf(null)).toBeNull();
    expect(tokenTotalOf({ input_tokens: 3 })).toBeNull();
    expect(tokenTotalOf({ input_tokens: 3, output_tokens: 4 })).toBe(7);
    expect(tokenTotalOf(shapes[11])).toBe(25); // cost_usd is not a token count
    expect(tokenTotalOf(shapes[12])).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// File keys: one sanitizer
// ---------------------------------------------------------------------------

describe("file keys", () => {
  const FILES = ["src/Money.php", "Money.php", "src/Billing/Invoice/Line.php", "./src/a.php", "src/__tests__/Foo.php"];

  test("the flow's attribute keys, the probe's key and the metrics identity are one key", () => {
    for (const file of FILES) {
      for (const round of [0, 1, 12]) {
        const identity = identityKeyOf(file, round);
        expect(identity).toBe(`${sanitizeFileKey(file)}#${round}`);
        expect([markerKeyOf(file, round), diffKeyOf(file, round), keptKeyOf(file, round), outKeyOf(file, round)]).toEqual(
          Array(4).fill(identity),
        );
        expect(markerKey(file, round)).toBe(identity);
        expect(verdictKeyOf(file, round, "reviewer-A")).toBe(`${identity}#reviewer-A`);
      }
    }
  });

  test("a session fence label carries the same sanitized file, and parses back to it", () => {
    for (const file of FILES) {
      const label = fenceLabel(file, 2, 3);
      expect(label).toBe(`porting-kit:${sanitizeFileKey(file)}#2#3`);
      expect(parseFenceLabel(label)).toEqual({ file: sanitizeFileKey(file), round: 2, epoch: 3 });
    }
  });

  test("the inverse restores any path whose own name has no `__`; the sanitized form never contains `/`", () => {
    for (const file of FILES.filter((f) => !f.includes("__"))) {
      expect(sanitizeFileKey(file)).not.toContain("/");
      expect(fileFromSanitizedKey(sanitizeFileKey(file))).toBe(file);
      expect(fileFromIdentity(identityKeyOf(file, 4))).toEqual({ file, round: 4 });
    }
  });

  test("no source spells the sanitizer or the `./` strip out by hand; src/file-keys.ts is the only home", () => {
    const sites = (pattern: RegExp): string[] =>
      productionSources("src", "flows", "scripts", "harness").filter((rel) => pattern.test(readSource(rel)));
    expect(sites(/\.replace\(\s*\/\\\/\/g\s*,\s*["']__["']\s*\)/)).toEqual(["src/file-keys.ts"]);
    expect(sites(/\.replace\(\s*\/\^\\\.\\\/\/\s*,\s*["']["']\s*\)/)).toEqual(["src/file-keys.ts"]);
  });
});

// ---------------------------------------------------------------------------
// The scaffold tsconfig: one builder, and what it must cover
// ---------------------------------------------------------------------------

describe("scaffold tsconfig", () => {
  const parse = (text: string) => JSON.parse(text) as { compilerOptions: Record<string, unknown>; include: string[] };

  test("is strict, emits nothing, and is the text the bootstrap writes by default", () => {
    expect(BOOTSTRAP_TSCONFIG).toBe(scaffoldTsconfigText());
    expect(BOOTSTRAP_TSCONFIG.endsWith("\n")).toBe(true);
    const config = parse(BOOTSTRAP_TSCONFIG);
    expect(config.compilerOptions.strict).toBe(true);
    expect(config.compilerOptions.noEmit).toBe(true);
    expect(config.include).toEqual(["src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"]);
  });

  test("an explicit include is written as given, and a source map only ever adds directories to the defaults", () => {
    expect(parse(scaffoldTsconfigText(["lib/**/*.ts"])).include).toEqual(["lib/**/*.ts"]);
    const map = { "src/A.php": { outPath: "./lib/a.ts" }, "src/B.php": { outPath: "app/b.tsx" }, "src/C.php": { outPath: "root.ts" } };
    const include = tsconfigIncludeFromSourceMap(map);
    for (const dir of parse(BOOTSTRAP_TSCONFIG).include) expect(include).toContain(dir);
    expect(include).toContain("lib/**/*.ts");
    expect(include).toContain("app/**/*.tsx");
    expect(include).toContain("root.ts");
  });

  test("every directory the bootstrapped vitest config runs tests from is inside the tsconfig include", () => {
    const config = bootstrapVitestConfig();
    const testGlobs = [...(/include:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    expect(testGlobs).toEqual([...BOOTSTRAP_TEST_GLOBS]);
    const include = parse(BOOTSTRAP_TSCONFIG).include;
    for (const glob of testGlobs) {
      // test/**/*.test.ts needs a test/**/*.ts include (or something wider)
      expect(include).toContain(glob.replace(/\.test\.ts$/, ".ts"));
    }
  });

  test("the generated vitest config text is unchanged (it is committed into every ported project)", () => {
    expect(bootstrapVitestConfig()).toBe(
      [
        'import { defineConfig } from "vitest/config";',
        "",
        "export default defineConfig({",
        "  test: {",
        '    include: ["test/**/*.test.ts", "tests/**/*.test.ts"],',
        "  },",
        "});",
        "",
      ].join("\n"),
    );
  });
});
