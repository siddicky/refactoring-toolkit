/**
 * Architecture guards: tests that read SOURCE TEXT on purpose, to pin a shape of
 * the code that no behavioural test can see (what a module must never call, how
 * many call sites a function has). They live together under this name, not
 * inside the feature suites, so a reader knows what kind of test fails and why;
 * behaviour is tested where the behaviour lives (see tests/jev-wiring.test.ts
 * for the judgment wiring, run for real).
 *
 * When one fails, fix the code or deliberately move the boundary here. Do not
 * loosen a guard to make it pass.
 */

import { describe, expect, test } from "bun:test";

import { portFlowSource } from "./support/port-flow-source.js";
import { productionSources, readSource, walkFiles } from "./support/source-files.js";

describe("architecture: the envelope stream is a projection, never read for correctness (US-007)", () => {
  test("control-flow modules contain no stream reads (readStream/listStreamMessages)", () => {
    const offenders = productionSources("flows", "src/git", "src/queues").filter((rel) =>
      /readStream|listStreamMessages/.test(readSource(rel)),
    );
    expect(offenders).toEqual([]);
  });

  test("the durable envelope attribute remains the only correctness source", () => {
    const envelope = readSource("flows/steps/envelope.ts");
    // The durable store exists under the key prefix every consumer matches on...
    expect(envelope).toMatch(/new AttributeMap<EnvelopeEvent>\(\s*"envelope-event"/);
    // ...and every durable write is immediately MIRRORED to the stream with the
    // same arguments (the stream copy follows the write; it never replaces it).
    const durableWrites = envelope.match(/envelopeEvents\.set\(/g) ?? [];
    const mirroredWrites =
      envelope.match(/envelopeEvents\.set\((\w+), (\w+), (\w+)\);\s*\n\s*publishEnvelopeEvent\(\1, \2, \3\);/g) ?? [];
    expect(durableWrites.length).toBeGreaterThan(0);
    expect(mirroredWrites.length).toBe(durableWrites.length);
    // The envelope module itself never READS a stream.
    expect(envelope).not.toMatch(/readStream|listStreamMessages/);
    // Stream consumers exist ONLY in the projection layer.
    for (const allowed of ["src/dashboard/queries.ts", "scripts/serve-status.ts", "scripts/watch-queue-verify.ts"]) {
      expect(readSource(allowed)).toMatch(/readStream/);
    }
    // The watcher core takes an INJECTED source: no direct SDK read.
    expect(readSource("src/watcher/queue-verify-watcher.ts")).not.toMatch(/readStream/);
  });
});

describe("architecture: the Jev client reaches every consumer through ONE seam", () => {
  test("the vitest-triage site (QueueVerifyStep -> classifyVitestRecords) resolves through liveJevClient()", () => {
    // QueueVerifyStep shells out to tsc/vitest, so it is not executed in the
    // wiring tests (they run verdict-check and prioritize); its call site is
    // pinned narrowly here. The dead second seam stays gone.
    const src = portFlowSource();
    const callSites = src
      .split("\n")
      .filter((l) => /\bclassifyVitestRecords\(/.test(l) && !l.includes("function classifyVitestRecords"));
    expect(callSites.length).toBe(1);
    expect(callSites[0]).toContain("liveJevClient()");
    expect(src.match(/let PORT_JEV_LIVE\b/)).toBeNull();
    expect(src.match(/function configurePortJevLive\b/)).toBeNull();
    expect(src.match(/function portJevLiveClient\b/)).toBeNull();
  });
});

describe("architecture: pointers to the port flow name the module that holds the code (C6)", () => {
  // The port flow was split out of flows/port-project.ts into flows/port/*.ts, and that file became the public
  // re-export entry. A comment that says "flows/port-project.ts runAgentTurn" (or a path:line into it) sends the
  // reader to a barrel that holds neither. Only these files may name the entry, because they are about the entry.
  const ABOUT_THE_ENTRY = new Set([
    "tests/architecture-guards.test.ts",
    "tests/port-project-exports.test.ts",
    "tests/support/port-flow-source.ts",
    "tests/README.md",
    ".agents/skills/porting-toolkit-migration/references/runner.md",
    // A historical log of how the runner was built, kept as it was written (its own header says the code wins).
    "BUILD_NOTES.md",
  ]);

  test("no other file refers to port-project.ts", () => {
    const offenders = walkFiles("", (rel) => /\.(?:ts|md|json|html)$/.test(rel) && !ABOUT_THE_ENTRY.has(rel)).filter(
      (rel) => /\bport-project\.ts\b/.test(readSource(rel)),
    );
    expect(offenders).toEqual([]);
  });

  test("every flows/port/<module>.ts a comment names exists", () => {
    const named = new Set<string>();
    for (const rel of walkFiles("", (r) => /\.(?:ts|md|json)$/.test(r) && r !== "BUILD_NOTES.md")) {
      for (const m of readSource(rel).matchAll(/\bflows\/port\/([a-z][a-z-]*\.ts)\b/g)) named.add(m[1] ?? "");
    }
    const present = new Set(walkFiles("flows/port").map((rel) => rel.slice("flows/port/".length)));
    expect([...named].filter((name) => !present.has(name))).toEqual([]);
  });
});

describe("architecture: hunk body ranges have one derivation (C5, C11)", () => {
  // suspicion.ts once re-derived the ranges from a 0-based index while the evidence lines are 1-based, which put the
  // `@@` line inside a hunk and the last body line outside it. It asks the parsed diff instead.
  test("suspicion.ts reads hunk membership only through parsed.hunkIdForBodyLine", () => {
    const code = readSource("src/metrics/suspicion.ts")
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
      .join("\n");
    expect(code).toContain("hunkIdForBodyLine");
    expect(code).not.toMatch(/HUNK_HEADER|new_start|new_lines|old_start|\.hunks\b|\.lines\b/);
  });

  test("only src/harness/runtime.ts computes the ranges", () => {
    const owners = productionSources("src", "flows", "harness", "scripts").filter((rel) =>
      /function hunkBodyRanges\b|HUNK_HEADER_RE\s*=/.test(readSource(rel)),
    );
    expect(owners).toEqual(["src/harness/runtime.ts"]);
  });
});

describe("architecture: source comments carry no build-process names", () => {
  // Comments such as "owned by worker-1/lead" or "maintained by worker-1b" name a
  // person on a past build, not anything a reader of the code can find.
  test("no TypeScript file refers to a numbered build worker", () => {
    const offenders = walkFiles("", (rel) => rel.endsWith(".ts") && rel !== "tests/architecture-guards.test.ts").filter(
      (rel) => /\bworker-\d/i.test(readSource(rel)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("architecture: recovery never fences nothing on a stub", () => {
  test("every pickHarness call site in run-demo is accounted for: two recovery sites require the real harness, the worker may fall back", () => {
    const source = readSource("scripts/run-demo.ts");
    const sites = [...source.matchAll(/await pickHarness\(([^)]*\)?[^)]*)\)/g)].map((m) => m[1] ?? "");
    const real = sites.filter((s) => s.includes("requireReal: true"));
    const plain = sites.filter((s) => !s.includes("requireReal"));
    expect(real).toHaveLength(2); // recover (--harness / HARNESS) + recover-port (--harness)
    expect(plain).toHaveLength(1); // worker start: auto may fall back, loudly
    expect(plain[0]).toContain("options.harness");
  });
});
