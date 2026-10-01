/**
 * INT-7 + INT-10 — every Lane-B Jev gate fails open LOUDLY and RECORDS it.
 *
 * Failing open (a live-Jev outage must not fail a durable step, which dex
 * would retry and re-bill) is deliberate; failing open SILENTLY is not. A
 * persistent auth or schema defect in the live client would otherwise run the
 * whole migration on the naive path with no signal.
 *
 * - INT-7: citation-check and prioritize already warned (T2); the threshold
 *   CITATION_MIN_P_JEV stays 0.8. This pins both, per gate.
 * - INT-10: classifyVitestRecords (vitest-triage) swallowed the failure with a
 *   bare catch: no log, no record. It now warns, reports through onTriage, and
 *   QueueVerifyStep persists `vitestTriage` on pp-verify.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncContext } from "@superdurable/dex";

import {
  classifyVitestRecords,
  PortProjectFlow,
  ppConfig,
  ppPrep,
  ppQueue,
  ppVerify,
  queueVerifyTools,
  runCitationGate,
  runPrioritizeGate,
  type PortQueueState,
  type PortRunInput,
  type QueueVerifyState,
} from "../flows/port-project.js";
import { configurePortJudgment } from "../flows/runtime-hooks.js";
import { CITATION_MIN_P_JEV, JUDGMENT_REGISTRY } from "../src/judgment-registry.js";
import type { DiffDocument, Finding, VerdictRecord } from "../src/metrics/types.js";
import { parseVitestOutput } from "../src/queues/vitest-queue.js";
import { createInMemoryJevClient, type JudgmentClient } from "../src/typesafe/client.js";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A real-kind (billed) client that is down. */
function downClient(): JudgmentClient & { calls: number } {
  const client = {
    kind: "real" as const,
    calls: 0,
    systemOne: async () => {
      client.calls += 1;
      throw new Error("jev unavailable (simulated outage)");
    },
  };
  return client as unknown as JudgmentClient & { calls: number };
}

let warnings: string[] = [];
const originalWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
});
afterEach(() => {
  console.warn = originalWarn;
  configurePortJudgment(createInMemoryJevClient()); // never leak a real-kind seam
  Object.assign(queueVerifyTools, PRODUCTION_TOOLS);
});

const DIFF: DiffDocument = {
  diff_id: "d1",
  file: "src/Money.php",
  base_ref: "HEAD",
  hunks: [
    {
      hunk_id: "h1",
      header: "@@ -0,0 +1,1 @@",
      old_start: 0,
      old_lines: 0,
      new_start: 1,
      new_lines: 1,
      lines: ["+export class Money {}"],
    },
  ],
};
const FINDING: Finding = {
  finding_id: "A1",
  severity: "major",
  summary: "s",
  evidence: { hunk_id: "h1", start_line: 1, end_line: 1, quote: "export class Money {}" },
};
const VERDICT: VerdictRecord = {
  file: "src/Money.php",
  reviewer: "reviewer-A",
  round: 1,
  diff_id: "d1",
  findings: [FINDING],
  citation_check: [],
};

// ---------------------------------------------------------------------------

describe("INT-7: the Jev keep threshold stays 0.8 and every gate warns when it fails open", () => {
  test("CITATION_MIN_P_JEV is 0.8, as the registry entry states it", () => {
    expect(CITATION_MIN_P_JEV).toBe(0.8);
    const entry = JUDGMENT_REGISTRY.find((e) => e.name === "citation-check");
    expect(entry?.threshold).toContain(String(CITATION_MIN_P_JEV));
  });

  test("citation-check: outage -> naive-fallback with the reason, and a warning naming the gate", async () => {
    const jev = downClient();
    const gate = await runCitationGate(VERDICT, DIFF, jev);
    expect(jev.calls).toBe(1);
    expect(gate.checker).toBe("naive-fallback");
    expect(gate.fallbackReason).toContain("jev unavailable");
    expect(gate.value.map((c) => c.p_cited)).toEqual([1]); // the naive check still ran
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[lane-b] live Jev failed in citation-check");
    expect(warnings[0]).toContain("jev unavailable");
  });

  test("prioritize: outage -> naive-fallback with the reason, and a warning naming the gate", async () => {
    const findings: Finding[] = [FINDING, { ...FINDING, finding_id: "A2", severity: "blocker" }];
    const gate = await runPrioritizeGate(findings, downClient());
    expect(gate.checker).toBe("naive-fallback");
    expect(gate.value.map((f) => f.finding_id)).toEqual(["A2", "A1"]); // severity order
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[lane-b] live Jev failed in prioritize");
  });

  test("no live client: the naive path is the plan, so nothing is warned", async () => {
    const gate = await runCitationGate(VERDICT, DIFF, undefined);
    expect(gate.checker).toBe("naive");
    expect(gate.fallbackReason).toBeNull();
    expect(warnings).toEqual([]);
  });
});

const VITEST_OUT = `
 RUN  v3.2.4 /itg

 ❯ test/price.test.ts (1 test | 1 failed) 5ms
   × top-level tax 0ms
     → expected 120 to be 110 // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed (1)
`;
const VITEST_ERR = `
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/price.test.ts > top-level tax
AssertionError: expected 120 to be 110 // Object.is equality

 ❯ test/price.test.ts:14:20
     12|
     13| test("top-level tax", () => {
     14|   expect(tax(100)).toBe(110);
       |                    ^

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
`;

describe("INT-10: vitest-triage records and logs its fail-open", () => {
  const records = parseVitestOutput(`${VITEST_OUT}\n${VITEST_ERR}`);

  test("the fixture really parses to one failure", () => {
    expect(records.length).toBe(1);
    expect(records[0]?.testFile).toBe("test/price.test.ts");
  });

  test("outage: the classification is naive, onTriage reports naive-fallback + reason, and it warns", async () => {
    const jev = downClient();
    const triage: Array<{ checker: string; fallbackReason: string | null }> = [];
    const state = await classifyVitestRecords(records, 1, jev, { onTriage: (t) => triage.push(t) }, {
      portedRoots: ["test"],
      portedTestRoots: ["test"],
    });

    expect(jev.calls).toBeGreaterThan(0);
    expect(state.total).toBe(1);
    expect(state.classified).toHaveLength(1);
    expect(triage).toHaveLength(1);
    expect(triage[0]?.checker).toBe("naive-fallback");
    expect(triage[0]?.fallbackReason).toContain("jev unavailable");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[lane-b] live Jev failed in vitest-triage");
    expect(warnings[0]).toContain("jev unavailable");
  });

  test("no live client: checker naive, no reason, no warning; a healthy client: checker jev", async () => {
    const naive: Array<{ checker: string; fallbackReason: string | null }> = [];
    await classifyVitestRecords(records, 1, undefined, { onTriage: (t) => naive.push(t) });
    expect(naive).toEqual([{ checker: "naive", fallbackReason: null }]);
    expect(warnings).toEqual([]);

    const healthy: JudgmentClient = {
      kind: "real",
      systemOne: async () =>
        ({
          model: "double",
          answers: {
            failure_attribution: {
              type: "choice",
              choice: "port_caused",
              confidence: 0.9,
              probabilities: { port_caused: 0.9, fixture_problem: 0.05, unknown: 0.05 },
            },
          },
          usage: { input_tokens: 10, output_tokens: 1 },
        }) as never,
    };
    const live: Array<{ checker: string; fallbackReason: string | null }> = [];
    await classifyVitestRecords(records, 1, healthy, { onTriage: (t) => live.push(t) });
    expect(live).toEqual([{ checker: "jev", fallbackReason: null }]);
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// QueueVerifyStep persists the record (fake tsc + fake vitest, real step)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const PRODUCTION_TOOLS = { ...queueVerifyTools };

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `lane-b-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fakeBin(path: string, stdout: string, stderr: string, exit: number): Promise<string> {
  const data = await tempDir("bin-data");
  await writeFile(join(data, "stdout"), stdout);
  await writeFile(join(data, "stderr"), stderr);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `#!/bin/sh\ncat "${join(data, "stdout")}"\ncat "${join(data, "stderr")}" >&2\nexit ${exit}\n`);
  await chmod(path, 0o755);
  return path;
}

type Stores = Map<unknown, Map<string, unknown>>;

function ctxOver(stores: Stores): AsyncContext {
  return {
    attempt: 1,
    flowId: "int10-triage",
    getAttribute: (attr: unknown, instance: string) => stores.get(attr)?.get(instance),
    setAttribute: (attr: unknown, value: unknown, instance: string) => {
      const store = stores.get(attr) ?? new Map<string, unknown>();
      store.set(instance, value);
      stores.set(attr, store);
    },
  } as unknown as AsyncContext;
}

async function runQueueVerify(): Promise<QueueVerifyState | undefined> {
  const itg = await tempDir("checkout");
  await mkdir(join(itg, "src"), { recursive: true });
  await mkdir(join(itg, "test"), { recursive: true });
  await writeFile(join(itg, "src", "price.ts"), "export const p = 1;\n");
  await writeFile(join(itg, "test", "price.test.ts"), "// ported test\n");
  await fakeBin(join(itg, "node_modules", ".bin", "vitest"), VITEST_OUT, VITEST_ERR, 1);
  queueVerifyTools.tscBin = await fakeBin(join(await tempDir("tsc"), "tsc"), "", "", 0);
  const queue: PortQueueState = {
    pending: [],
    current: null,
    done: [{ file: "test/PriceTest.php", round: 1, commitSha: null, treeHash: null }],
    blocked: [],
  };
  const stores: Stores = new Map();
  stores.set(ppQueue, new Map([["queue", queue]]));
  stores.set(ppConfig, new Map([["config", { maxRounds: 3, prepMaxRounds: 1 }]]));
  stores.set(
    ppPrep,
    new Map([["prep", { raw: "", symbolTable: [], sourceMap: { "test/PriceTest.php": { outPath: "test/price.test.ts", notes: "" } } }]]),
  );
  const input: PortRunInput = {
    repoRoot: itg,
    worktreeRoot: join(itg, ".wt"),
    integrationWorktreePath: itg,
    epoch: 1,
    sourceRoot: itg,
    prepPath: "",
    files: [],
    maxRounds: 3,
    dispatchMode: "parallel",
  };
  await new PortProjectFlow().queueVerify.execute(ctxOver(stores), input);
  return stores.get(ppVerify)?.get("verify") as QueueVerifyState | undefined;
}

describe("INT-10: QueueVerifyStep persists the triage record on pp-verify", () => {
  test("live Jev down: vitestTriage says naive-fallback and why; the failure is still routed to its file", async () => {
    configurePortJudgment(downClient());
    const verify = await runQueueVerify();

    expect(verify?.vitestTriage?.checker).toBe("naive-fallback");
    expect(verify?.vitestTriage?.fallbackReason).toContain("jev unavailable");
    expect(verify?.vitestState?.classified).toHaveLength(1);
    expect(verify?.fixQueue.map((f) => f.file)).toEqual(["test/PriceTest.php"]);
    expect(warnings.some((w) => w.includes("[lane-b] live Jev failed in vitest-triage"))).toBe(true);
  }, 30_000);

  test("no live client: vitestTriage is the plain naive record, nothing warned", async () => {
    configurePortJudgment(createInMemoryJevClient());
    const verify = await runQueueVerify();

    expect(verify?.vitestTriage).toEqual({ checker: "naive", fallbackReason: null });
    expect(warnings).toEqual([]);
  }, 30_000);
});
