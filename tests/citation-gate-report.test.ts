/**
 * C14: the report shows the citation gate's OWN score.
 *
 * The verdict record carries the deterministic citation check stamped at review
 * time. With a live Jev key the gate decides on Jev's p_cited instead, and that
 * score was persisted only in `pp-kept` (`citationGate` + `dropped[].p_cited`),
 * which the report never read: it could print 1.00 for a finding the gate had
 * dropped at 0.30. This pushes the record the flow REALLY writes (keepFindings)
 * through the collector and the renderer.
 */

import { describe, expect, test } from "bun:test";

import { keepFindings, type CitationScores } from "../flows/port/lane-b.js";
import type { ReviewTuple, ReviewVerdict } from "../flows/port-project.js";
import { collectCitationGates, type StateAttribute } from "../src/metrics/collect.js";
import { renderReport } from "../src/metrics/render.js";
import type { CitationGateView, EnvelopeEvent, Finding, VerdictRecord } from "../src/metrics/types.js";

const finding = (id: string): Finding => ({
  finding_id: id,
  severity: "major",
  summary: `finding ${id}`,
  evidence: { hunk_id: "h1", start_line: 1, end_line: 1, quote: "x" },
});

/** The verdict record as the flow stamps it: the deterministic check says every quote is in the diff. */
const verdictRecord = (reviewer: string, ids: string[]): VerdictRecord => ({
  file: "src/a.php",
  reviewer,
  round: 1,
  diff_id: "d1",
  findings: ids.map(finding),
  citation_check: ids.map((id) => ({ finding_id: id, p_cited: 1 })),
});

const tuple = (reviewer: string, findings: Array<{ id: string; disposition: "fix" | "wontfix" }>): ReviewTuple =>
  ({
    agent: { findings: findings.map((f) => ({ finding_id: f.id, disposition: f.disposition })) },
    metrics: { ...verdictRecord(reviewer, findings.map((f) => f.id)) },
  }) as unknown as ReviewTuple;

/** What the live-Jev gate ran: reviewer-A's F2 scored 0.30 and was dropped, F3 is a wontfix. */
async function liveJevGate() {
  const verdicts: Record<string, ReviewVerdict> = {
    "reviewer-A": tuple("reviewer-A", [
      { id: "F1", disposition: "fix" },
      { id: "F2", disposition: "fix" },
      { id: "F3", disposition: "wontfix" },
    ]),
    "reviewer-B": tuple("reviewer-B", [{ id: "F1", disposition: "fix" }]),
  };
  const scores: Record<string, CitationScores> = {
    "reviewer-A": {
      checker: "jev",
      fallbackReason: null,
      checks: [
        { finding_id: "F1", p_cited: 0.97 },
        { finding_id: "F2", p_cited: 0.3 },
        { finding_id: "F3", p_cited: 0.99 },
      ],
    },
    "reviewer-B": {
      checker: "naive-fallback",
      fallbackReason: "Jev provider unreachable",
      checks: [{ finding_id: "F1", p_cited: 1 }],
    },
  };
  return keepFindings({
    verdictOf: (id) => verdicts[id] as ReviewVerdict,
    scoreCitations: (id) => Promise.resolve(scores[id] as CitationScores),
  });
}

/** The attribute `dexcli flow state` lists for the flow's pp-kept record. */
const keptAttribute = (value: unknown, key = "pp-kept/src__a.php#1"): StateAttribute => ({ key, value });

const envelope = (over: Partial<EnvelopeEvent>): EnvelopeEvent => ({
  stepId: "pp-review-a",
  role: "review",
  file: null,
  round: 1,
  attempt: 1,
  started_at: "2026-09-26T10:00:00Z",
  ended_at: "2026-09-26T10:01:00Z",
  outcome: "completed",
  tokens: null,
  wall_clock_ms: 1000,
  identity: "src__a.php#1",
  ...over,
});

describe("collectCitationGates", () => {
  test("reads the record the flow writes: the gate's p_cited and what it did with each finding, per reviewer", async () => {
    const gates = collectCitationGates([keptAttribute(await liveJevGate())]);
    expect(gates).toEqual([
      {
        file: "src/a.php",
        round: 1,
        reviewer: "reviewer-A",
        checker: "jev",
        fallbackReason: null,
        scores: [
          { finding_id: "F1", p_cited: 0.97, outcome: "kept" },
          { finding_id: "F2", p_cited: 0.3, outcome: "dropped-citation" },
          { finding_id: "F3", p_cited: 0.99, outcome: "dropped-disposition" },
        ],
      },
      {
        file: "src/a.php",
        round: 1,
        reviewer: "reviewer-B",
        checker: "naive-fallback",
        fallbackReason: "Jev provider unreachable",
        scores: [{ finding_id: "F1", p_cited: 1, outcome: "kept" }],
      },
    ]);
  });

  test("records without citationGate (older evidence), other attributes and malformed values yield nothing", () => {
    expect(
      collectCitationGates([
        keptAttribute({ findings: [], dropped: [] }),
        keptAttribute({ citationGate: "nope" }, "pp-kept/src__b.php#1"),
        keptAttribute({ citationGate: [{ reviewer: 7, scores: [] }, null, { reviewer: "r", scores: "x" }] }, "pp-kept/src__c.php#1"),
        keptAttribute(null, "pp-kept/src__d.php#1"),
        keptAttribute({ citationGate: [] }, "pp-kept/not-a-file-round"),
        { key: "pp-verdict/src__a.php#1#reviewer-A", value: { citationGate: [] } },
      ]),
    ).toEqual([]);
  });

  test("a score entry without a finding id or a number is skipped, the rest of the record is kept", () => {
    const gates = collectCitationGates([
      keptAttribute({
        dropped: [],
        citationGate: [{ reviewer: "reviewer-A", checker: "naive", fallbackReason: null, scores: [{ finding_id: "F1", p_cited: 1 }, { finding_id: 9, p_cited: 1 }, { finding_id: "F2" }] }],
      }),
    ]);
    expect(gates[0]?.scores).toEqual([{ finding_id: "F1", p_cited: 1, outcome: "kept" }]);
  });
});

describe("renderReport shows the gate's score beside the review-time check", () => {
  const render = async (citationGates: readonly CitationGateView[]) =>
    renderReport({
      envelopes: [envelope({}), envelope({ stepId: "pp-review-b", identity: "src__a.php#1" })],
      verdicts: [verdictRecord("reviewer-A", ["F1", "F2", "F3"]), verdictRecord("reviewer-B", ["F1"])],
      burnDown: [],
      citationGates,
    });

  test("a finding the live gate dropped at 0.30 is no longer shown as 1.00 and nothing else", async () => {
    const rendered = await render(collectCitationGates([keptAttribute(await liveJevGate())]));
    const md = rendered.markdown;
    expect(md).toContain("- citation gate (jev) reviewer-A: F1=0.97 kept, F2=0.30 dropped (citation), F3=0.99 dropped (disposition)");
    expect(md).toContain("- citation gate (naive-fallback: Jev provider unreachable) reviewer-B: F1=1.00 kept");
    // the verdict records' own check is still there, and now says what it is
    expect(md).toContain("- review-time citation checks (deterministic, before the gate): F1=1.00, F2=1.00, F3=1.00, F1=1.00");
    expect(md).not.toContain("- citation checks:");
  });

  test("the JSON carries the gate per file-round, next to the review-time checks", async () => {
    const rendered = await render(collectCitationGates([keptAttribute(await liveJevGate())]));
    const fr = rendered.json.file_rounds.find((r) => r.file === "src/a.php" && r.round === 1);
    expect(fr?.citation_gate.map((g) => [g.reviewer, g.checker, g.scores.map((s) => [s.finding_id, s.p_cited, s.outcome])])).toEqual([
      ["reviewer-A", "jev", [["F1", 0.97, "kept"], ["F2", 0.3, "dropped-citation"], ["F3", 0.99, "dropped-disposition"]]],
      ["reviewer-B", "naive-fallback", [["F1", 1, "kept"]]],
    ]);
    expect(fr?.citation_checks.map((c) => c.p_cited)).toEqual([1, 1, 1, 1]);
  });

  test("with no gate record (older evidence) the deterministic check is shown, labelled as such", async () => {
    const rendered = await render([]);
    expect(rendered.markdown).toContain("- citation checks (deterministic, at review time; no gate record): F1=1.00, F2=1.00, F3=1.00, F1=1.00");
    expect(rendered.markdown).not.toContain("citation gate (");
    expect(rendered.json.file_rounds[0]?.citation_gate).toEqual([]);
  });

  test("a gate record for another round or file is not attached", async () => {
    const other: CitationGateView[] = [
      { file: "src/other.php", round: 1, reviewer: "reviewer-A", checker: "jev", fallbackReason: null, scores: [{ finding_id: "F1", p_cited: 0.5, outcome: "dropped-citation" }] },
      { file: "src/a.php", round: 2, reviewer: "reviewer-A", checker: "jev", fallbackReason: null, scores: [{ finding_id: "F1", p_cited: 0.5, outcome: "dropped-citation" }] },
    ];
    const rendered = await render(other);
    expect(rendered.json.file_rounds.find((r) => r.file === "src/a.php" && r.round === 1)?.citation_gate).toEqual([]);
  });
});
