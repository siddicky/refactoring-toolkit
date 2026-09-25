/**
 * Unit tests for harness/agents/verdict-schema.ts — standalone, assert-based.
 * Run: bun run harness/agents/verdict-schema.test.ts
 */

import {
  SEVERITIES,
  isSeverity,
  isCompletedVerdictRecord,
  severityList,
  validateFinding,
  validateVerdictRecord,
} from "./verdict-schema.js";
import { assertEquals, assertTrue, runTestFile } from "../../src/queues/testkit.js";

function validRecord(): Record<string, unknown> {
  return {
    file: "src/services/user-service.ts",
    reviewer: "reviewer-1",
    round: 2,
    diff_id: "diff-0002-user-service",
    findings: [
      {
        finding_id: "F1",
        severity: "blocker",
        evidence_span: { start_line: 40, end_line: 42, snippet: "user.name as any" },
        disposition: "fix",
      },
      {
        finding_id: "F2",
        severity: "nit",
        evidence_span: { start_line: 7, end_line: 7 },
        disposition: "wontfix",
      },
    ],
    citation_check: [
      { finding_id: "F1", p_cited: 0.97 },
      { finding_id: "F2", p_cited: 0.5 },
    ],
  };
}

runTestFile("verdict-schema", {
  "severity enum is exactly blocker|major|minor|nit (exhaustiveness)": () => {
    assertEquals([...SEVERITIES], ["blocker", "major", "minor", "nit"]);
    assertEquals(severityList(), "blocker | major | minor | nit");
    for (const s of SEVERITIES) {
      assertTrue(isSeverity(s), `"${s}" is a severity`);
    }
    for (const bad of ["critical", "BLOCKER", "", "blockers", 3, null]) {
      assertTrue(!isSeverity(bad), `non-severity ${JSON.stringify(bad)} rejected`);
    }
  },

  "accepts a fully valid verdict record": () => {
    const result = validateVerdictRecord(validRecord());
    assertTrue(result.ok, `expected ok, got ${JSON.stringify(result)}`);
    if (result.ok) {
      assertEquals(result.value.findings.length, 2);
      assertEquals(result.value.citation_check[0], { finding_id: "F1", p_cited: 0.97 });
      assertEquals(result.value.file, "src/services/user-service.ts");
    }
    assertTrue(isCompletedVerdictRecord(validRecord()), "guard form agrees");
  },

  "empty findings + empty citation_check is a completed clean review": () => {
    const clean = { ...validRecord(), findings: [], citation_check: [] };
    const result = validateVerdictRecord(clean);
    assertTrue(result.ok, "clean review must validate");
    if (result.ok) {
      assertEquals(result.value.findings, []);
      assertEquals(result.value.citation_check, []);
    }
  },

  "rejects missing required fields and reports them": () => {
    const missing = validRecord() as Record<string, unknown>;
    delete missing.diff_id;
    delete missing.round;
    const result = validateVerdictRecord(missing);
    assertTrue(!result.ok, "must reject");
    if (!result.ok) {
      const joined = result.errors.join("; ");
      assertTrue(joined.includes("diff_id"), "reports missing diff_id");
      assertTrue(joined.includes("round"), "reports missing round");
    }
  },

  "rejects unknown severity values": () => {
    const bad = validRecord();
    (bad.findings as Record<string, unknown>[])[0]!.severity = "critical";
    const result = validateVerdictRecord(bad);
    assertTrue(!result.ok, "unknown severity rejected");
    if (!result.ok) {
      assertTrue(
        result.errors.join("; ").includes("severity"),
        "error names the severity field",
      );
    }
  },

  "rejects citations pointing at unknown findings, duplicates, bad p_cited": () => {
    const unknownRef = validRecord();
    (unknownRef.citation_check as Record<string, unknown>[])[1]!.finding_id = "F999";
    assertTrue(!validateVerdictRecord(unknownRef).ok, "unknown finding ref rejected");

    const dup = validRecord();
    (dup.citation_check as Record<string, unknown>[])[1]!.finding_id = "F1";
    assertTrue(!validateVerdictRecord(dup).ok, "duplicate citation rejected");

    const outOfRange = validRecord();
    (outOfRange.citation_check as Record<string, unknown>[])[0]!.p_cited = 1.5;
    assertTrue(!validateVerdictRecord(outOfRange).ok, "p_cited > 1 rejected");

    const negative = validRecord();
    (negative.citation_check as Record<string, unknown>[])[0]!.p_cited = -0.1;
    assertTrue(!validateVerdictRecord(negative).ok, "negative p_cited rejected");
  },

  "rejects duplicate finding ids and bad evidence spans": () => {
    const dupIds = validRecord();
    (dupIds.findings as Record<string, unknown>[])[1]!.finding_id = "F1";
    assertTrue(!validateVerdictRecord(dupIds).ok, "duplicate finding_id rejected");

    const inverted = validRecord();
    (inverted.findings as Record<string, unknown>[])[0]!.evidence_span = {
      start_line: 9,
      end_line: 4,
    };
    assertTrue(!validateVerdictRecord(inverted).ok, "end_line < start_line rejected");

    const zero = validRecord();
    (zero.findings as Record<string, unknown>[])[0]!.evidence_span = {
      start_line: 0,
      end_line: 3,
    };
    assertTrue(!validateVerdictRecord(zero).ok, "non-positive line rejected");
  },

  "rejects non-object input and wrong scalar types": () => {
    assertTrue(!validateVerdictRecord(null).ok, "null rejected");
    assertTrue(!validateVerdictRecord("verdict").ok, "string rejected");
    assertTrue(!validateVerdictRecord([]).ok, "array rejected");

    const wrongTypes = validRecord();
    wrongTypes.round = "2";
    assertTrue(!validateVerdictRecord(wrongTypes).ok, "non-integer round rejected");
  },

  "validateFinding reports all finding-level errors with a path": () => {
    const result = validateFinding(
      { finding_id: "", severity: "mega", evidence_span: "nowhere", disposition: "" },
      "findings[3]",
    );
    assertTrue(!result.ok, "bad finding rejected");
    if (!result.ok) {
      const joined = result.errors.join("; ");
      assertTrue(joined.includes("findings[3]"), "error paths are prefixed");
      assertTrue(joined.includes("finding_id"), "reports finding_id");
      assertTrue(joined.includes("severity"), "reports severity");
      assertTrue(joined.includes("disposition"), "reports disposition");
      assertTrue(joined.includes("evidence_span"), "reports evidence_span");
    }
  },
});
