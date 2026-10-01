/**
 * INT-8 (audit C38) — live Jev spend written by the flows is the spend the
 * report prints.
 *
 * T2's envelope.ts comments say the verdict-check / prioritize / vitest-triage
 * steps record their live Jev tokens in the `pp-jev-usage` attribute and that
 * render-metrics reports them separately; T5 added the reader. Nothing checked
 * the two ends against each other: attribute name, key layout, entry shape,
 * and the fact that every recording step actually declares the attribute (a
 * step that reads an undeclared AttributeMap throws in dex). This runs the real
 * steps with a billed client double and feeds their attribute to the real
 * collector and renderer.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Context } from "@superdurable/dex";

import {
  markerKeyOf,
  PortFileFlow,
  PortProjectFlow,
  portPersistenceSchema,
  ppDiff,
  ppJevUsage,
  ppKept,
  ppVerdict,
  ppVerify,
  type CapturedDiff,
  type FileRoundInput,
  type KeptFindings,
  type QueueVerifyState,
  type ReviewTuple,
} from "../flows/port-project.js";
import { configurePortJudgment } from "../flows/runtime-hooks.js";
import { DIFF_HEADER_LINES } from "../src/harness/runtime.js";
import { collectJevUsage, type StateAttribute } from "../src/metrics/collect.js";
import { renderReport } from "../src/metrics/render.js";
import type { DiffDocument, Finding, VerdictRecord } from "../src/metrics/types.js";
import { createInMemoryJevClient, type JudgmentClient, type SystemOneRequest } from "../src/typesafe/client.js";
import {
  cleanupQueueVerifyRun,
  ONE_FAILURE_STDERR,
  ONE_FAILURE_STDOUT,
  runQueueVerifyOverFakeTools,
  type Stores,
} from "./helpers/queue-verify-run.js";

const FILE = "src/Money.php";
const KEY = markerKeyOf(FILE, 1);

const DIFF_DOC: DiffDocument = {
  diff_id: "d1",
  file: FILE,
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
const DIFF_ATTR: CapturedDiff = {
  diffId: "d1",
  raw: "diff --git a/src/money.ts b/src/money.ts\n--- /dev/null\n+++ b/src/money.ts\n@@ -0,0 +1,1 @@\n+export class Money {}",
  doc: DIFF_DOC,
  bodyLineOffset: DIFF_HEADER_LINES,
};
const FRI: FileRoundInput = {
  repoRoot: "/tmp/int8",
  worktreeRoot: "/tmp/int8/.wt",
  integrationWorktreePath: "/tmp/int8/.wt/integration",
  sourceRoot: "/tmp/int8/src",
  epoch: 1,
  file: FILE,
  round: 1,
  worktreePath: "/tmp/int8/.wt/money-1",
  branch: "lease/money/1",
};

const finding = (id: string, severity: Finding["severity"]): Finding => ({
  finding_id: id,
  severity,
  summary: `summary ${id}`,
  evidence: { hunk_id: "h1", start_line: 1, end_line: 1, quote: "export class Money {}" },
});

/** A billed client double: every call costs 10 input + 5 output tokens (15). */
function billedClient(): JudgmentClient {
  return {
    kind: "real",
    systemOne: async (request: SystemOneRequest) => {
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(request.questions)) {
        answers[name] =
          name === "failure_attribution"
            ? {
                type: "choice",
                choice: "port_caused",
                confidence: 0.9,
                probabilities: { port_caused: 0.9, fixture_problem: 0.05, unknown: 0.05 },
              }
            : { type: "noul", noul: 0.95 };
      }
      return { model: "jev-double", answers: answers as never, usage: { input_tokens: 10, output_tokens: 5 } };
    },
  } as unknown as JudgmentClient;
}

function ctxFor(stores: Stores, step: { getStepOptions?: () => unknown }): Context {
  const options = step.getStepOptions?.() as { executeLoadAttributeMaps?: readonly unknown[] } | undefined;
  const declared = options?.executeLoadAttributeMaps ?? [];
  return {
    attempt: 1,
    flowId: "int8",
    getAttribute: (attr: unknown, instance: string) => {
      if (!declared.includes(attr)) {
        throw new Error(`AttributeMap instance was not loaded: ${(attr as { name?: string }).name ?? "?"}/${instance}`);
      }
      return stores.get(attr)?.get(instance);
    },
    setAttribute: (attr: unknown, value: unknown, instance: string) => {
      const store = stores.get(attr) ?? new Map<string, unknown>();
      store.set(instance, value);
      stores.set(attr, store);
    },
  } as unknown as Context;
}

function tuple(reviewer: string, findings: Finding[]): ReviewTuple {
  const metrics: VerdictRecord = { file: FILE, reviewer, round: 1, diff_id: "d1", findings, citation_check: [] };
  return {
    agent: {
      file: FILE,
      reviewer,
      round: 1,
      diff_id: "d1",
      findings: findings.map((f) => ({
        finding_id: f.finding_id,
        severity: f.severity,
        description: f.summary,
        evidence_span: { start_line: 1, end_line: 1, snippet: f.evidence?.quote ?? "" },
        disposition: "fix" as const,
      })),
      citation_check: [],
    },
    metrics,
  };
}

/** One file-round's Lane-B steps (verdict-check then prioritize) under a billed client. */
async function runLaneB(flow: Pick<PortFileFlow, "verdictCheck" | "prioritize">): Promise<Stores> {
  const stores: Stores = new Map();
  stores.set(ppDiff, new Map([[KEY, DIFF_ATTR]]));
  stores.set(
    ppVerdict,
    new Map([
      [`${KEY}#reviewer-A`, tuple("reviewer-A", [finding("A1", "major"), finding("A2", "nit")])],
      [`${KEY}#reviewer-B`, tuple("reviewer-B", [])],
    ]),
  );
  await flow.verdictCheck.execute(ctxFor(stores, flow.verdictCheck) as never, FRI);
  const kept = stores.get(ppKept)?.get(KEY) as KeptFindings | undefined;
  expect(kept?.findings.length).toBeGreaterThan(0);
  await flow.prioritize.execute(ctxFor(stores, flow.prioritize) as never, FRI);
  return stores;
}

/** The attribute exactly as `dexcli flow state` lists it: `<map name>/<instance>`. */
function attributesOf(stores: Stores): StateAttribute[] {
  const name = (ppJevUsage as unknown as { name: string }).name;
  return [...(stores.get(ppJevUsage)?.entries() ?? [])].map(([instance, value]) => ({
    key: `${name}/${instance}`,
    value,
  }));
}

afterEach(async () => {
  configurePortJudgment(createInMemoryJevClient());
  await cleanupQueueVerifyRun();
});

describe("INT-8: every step that records Jev spend can, and its attribute is persisted", () => {
  const project = new PortProjectFlow();
  const file = new PortFileFlow();

  test("verdict-check, prioritize and queue-verify declare pp-jev-usage (an undeclared read throws in dex)", () => {
    for (const step of [file.verdictCheck, file.prioritize, project.queueVerify, project.verdictCheck, project.prioritize]) {
      const options = (step as { getStepOptions?: () => unknown }).getStepOptions?.() as
        | { executeLoadAttributeMaps?: readonly unknown[] }
        | undefined;
      expect(options?.executeLoadAttributeMaps).toContain(ppJevUsage);
    }
  });

  test("the attribute is in the persistence schema both flows return", () => {
    expect(portPersistenceSchema().attributes).toContain(ppJevUsage);
    expect(project.getPersistenceSchema().attributes).toContain(ppJevUsage);
    expect(file.getPersistenceSchema().attributes).toContain(ppJevUsage);
  });

  test("the attribute name the reader scans for is the one the flow writes", () => {
    expect((ppJevUsage as unknown as { name: string }).name).toBe("pp-jev-usage");
  });
});

describe("INT-8: Jev spend from the real steps reaches the report", () => {
  test("verdict-check + prioritize, in a parent and a child flow, add up in jev_usage and the markdown", async () => {
    configurePortJudgment(billedClient());
    const parent = await runLaneB(new PortProjectFlow());
    const child = await runLaneB(new PortFileFlow());

    // each flow keeps its own log; the driver passes the concatenation
    const usageEntries = [...attributesOf(parent), ...attributesOf(child)];
    expect(usageEntries.length).toBe(2);
    const entries = collectJevUsage(usageEntries);
    expect(entries.map((e) => e.stepId).sort()).toEqual([
      `pp-prioritize:${FILE}#1`,
      `pp-prioritize:${FILE}#1`,
      `pp-verdict-check:${FILE}#1`,
      `pp-verdict-check:${FILE}#1`,
    ]);
    expect(entries.every((e) => e.tokens === 15)).toBe(true);

    const rendered = renderReport({ envelopes: [], verdicts: [], burnDown: [], jevUsage: entries });
    expect(rendered.json.jev_usage).toEqual({
      calls: 4,
      total_tokens: 60,
      cost_usd: null,
      by_step: [
        { step: "pp-prioritize", calls: 2, tokens: 30 },
        { step: "pp-verdict-check", calls: 2, tokens: 30 },
      ],
    });
    expect(rendered.markdown).toContain("judgment (Jev) tokens: 60");
    expect(rendered.markdown).toContain("total: 60 tokens over 4 call(s) — NOT included in the model-calling token total");
    expect(rendered.markdown).toContain("| pp-verdict-check | 2 | 30 |");
  });

  test("vitest triage spend (real QueueVerifyStep) is recorded under its own step and rendered", async () => {
    configurePortJudgment(billedClient());
    const stores = await runQueueVerifyOverFakeTools({
      vitestStdout: ONE_FAILURE_STDOUT,
      vitestStderr: ONE_FAILURE_STDERR,
    });
    const verify = stores.get(ppVerify)?.get("verify") as QueueVerifyState | undefined;
    expect(verify?.vitestTriage).toEqual({ checker: "jev", fallbackReason: null });

    const entries = collectJevUsage(attributesOf(stores));
    expect(entries.map((e) => [e.stepId, e.tokens])).toEqual([["pp-queue-verify:vitest-triage", 15]]);

    const rendered = renderReport({ envelopes: [], verdicts: [], burnDown: [], jevUsage: entries });
    expect(rendered.json.jev_usage?.by_step).toEqual([{ step: "pp-queue-verify:vitest-triage", calls: 1, tokens: 15 }]);
    expect(rendered.markdown).toContain("| pp-queue-verify:vitest-triage | 1 | 15 |");
  }, 30_000);

  test("the naive path records nothing, and the report says so rather than printing a zero", async () => {
    configurePortJudgment(createInMemoryJevClient());
    const stores = await runLaneB(new PortFileFlow());
    expect(stores.get(ppJevUsage)).toBeUndefined();

    const rendered = renderReport({ envelopes: [], verdicts: [], burnDown: [], jevUsage: collectJevUsage(attributesOf(stores)) });
    expect(rendered.json.jev_usage).toBeNull();
    expect(rendered.markdown).toContain("_none recorded (naive judgment path or no live Jev spend)_");
  });
});
