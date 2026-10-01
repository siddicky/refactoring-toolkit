/**
 * Unit tests for harness/agents/verdict-schema.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  DISPOSITIONS,
  SEVERITIES,
  dispositionList,
  isSeverity,
  normalizeDisposition,
  isCompletedVerdictRecord,
  severityList,
  validateFinding,
  validateVerdictRecord,
} from "./verdict-schema.js";

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
        description: "casts user.name to any, silencing strict mode",
        evidence_span: { start_line: 40, end_line: 42, snippet: "user.name as any" },
        disposition: "fix",
      },
      {
        finding_id: "F2",
        severity: "nit",
        description: "import order differs from the conventions",
        evidence_span: { start_line: 7, end_line: 7, snippet: "import { b } from './b'" },
        disposition: "wontfix",
      },
    ],
    citation_check: [
      { finding_id: "F1", p_cited: 0.97 },
      { finding_id: "F2", p_cited: 0.5 },
    ],
  };
}

describe("verdict-schema", () => {
  test("severity enum is exactly blocker|major|minor|nit (exhaustiveness)", () => {
    expect([...SEVERITIES]).toStrictEqual(["blocker", "major", "minor", "nit"]);
    expect(severityList()).toBe("blocker | major | minor | nit");
    for (const s of SEVERITIES) {
      expect(isSeverity(s)).toBe(true);
    }
    for (const bad of ["critical", "BLOCKER", "", "blockers", 3, null]) {
      expect(isSeverity(bad)).toBe(false);
    }
  });

  test("accepts a fully valid verdict record", () => {
    const result = validateVerdictRecord(validRecord());
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.value.findings.length).toBe(2);
    expect(result.value.findings[0]?.description).toBe("casts user.name to any, silencing strict mode");
    expect(result.value.citation_check[0]).toStrictEqual({ finding_id: "F1", p_cited: 0.97 });
    expect(result.value.file).toBe("src/services/user-service.ts");
    // the guard form agrees
    expect(isCompletedVerdictRecord(validRecord())).toBe(true);
  });

  test("empty findings + empty citation_check is a completed clean review", () => {
    const clean = { ...validRecord(), findings: [], citation_check: [] };
    const result = validateVerdictRecord(clean);
    if (!result.ok) throw new Error("clean review must validate");
    expect(result.value.findings).toStrictEqual([]);
    expect(result.value.citation_check).toStrictEqual([]);
  });

  test("rejects missing required fields and reports them", () => {
    const missing = validRecord() as Record<string, unknown>;
    delete missing.diff_id;
    delete missing.round;
    const result = validateVerdictRecord(missing);
    if (result.ok) throw new Error("must reject");
    const joined = result.errors.join("; ");
    expect(joined).toContain("diff_id");
    expect(joined).toContain("round");
  });

  test("rejects unknown severity values", () => {
    const bad = validRecord();
    (bad.findings as Record<string, unknown>[])[0]!.severity = "critical";
    const result = validateVerdictRecord(bad);
    if (result.ok) throw new Error("unknown severity must be rejected");
    expect(result.errors.join("; ")).toContain("severity");
  });

  test("citation_check is advisory: bad self-reports are dropped, never reject the verdict (C14)", () => {
    const unknownRef = validRecord();
    (unknownRef.citation_check as Record<string, unknown>[])[1]!.finding_id = "F999";
    const r1 = validateVerdictRecord(unknownRef);
    if (!r1.ok) throw new Error("unknown finding ref must be tolerated");
    expect(r1.value.citation_check.map((c) => c.finding_id)).toStrictEqual(["F1"]);

    const dup = validRecord();
    (dup.citation_check as Record<string, unknown>[])[1]!.finding_id = "F1";
    const r2 = validateVerdictRecord(dup);
    if (!r2.ok) throw new Error("duplicate citation must be tolerated");
    expect(r2.value.citation_check.length).toBe(1);

    const outOfRange = validRecord();
    (outOfRange.citation_check as Record<string, unknown>[])[0]!.p_cited = 1.5;
    const r3 = validateVerdictRecord(outOfRange);
    if (!r3.ok) throw new Error("p_cited > 1 must be tolerated");
    expect(r3.value.citation_check.map((c) => c.finding_id)).toStrictEqual(["F2"]);

    const negative = validRecord();
    (negative.citation_check as Record<string, unknown>[])[0]!.p_cited = -0.1;
    expect(validateVerdictRecord(negative).ok).toBe(true);

    const absent = validRecord();
    delete absent.citation_check;
    const r4 = validateVerdictRecord(absent);
    if (!r4.ok) throw new Error("missing citation_check must be tolerated");
    expect(r4.value.citation_check).toStrictEqual([]);

    const notArray = { ...validRecord(), citation_check: "high" };
    expect(validateVerdictRecord(notArray).ok).toBe(true);
  });

  test("description and snippet are required on every finding (C12/C14)", () => {
    const noDescription = validRecord();
    delete (noDescription.findings as Record<string, unknown>[])[0]!.description;
    const r1 = validateVerdictRecord(noDescription);
    if (r1.ok) throw new Error("missing description must be rejected");
    expect(r1.errors.join("; ")).toContain("description");

    const blankDescription = validRecord();
    (blankDescription.findings as Record<string, unknown>[])[0]!.description = "   ";
    expect(validateVerdictRecord(blankDescription).ok).toBe(false);

    const noSnippet = validRecord();
    (noSnippet.findings as Record<string, unknown>[])[1]!.evidence_span = { start_line: 7, end_line: 7 };
    const r2 = validateVerdictRecord(noSnippet);
    if (r2.ok) throw new Error("missing snippet must be rejected");
    expect(r2.errors.join("; ")).toContain("snippet");

    const emptySnippet = validRecord();
    (emptySnippet.findings as Record<string, unknown>[])[1]!.evidence_span = { start_line: 7, end_line: 7, snippet: "" };
    expect(validateVerdictRecord(emptySnippet).ok).toBe(false);
  });

  test("disposition is a closed enum with case/punctuation normalization (C14)", () => {
    expect([...DISPOSITIONS]).toStrictEqual(["fix", "wontfix"]);
    expect(dispositionList()).toBe("fix | wontfix");
    for (const [raw, expected] of [
      ["fix", "fix"],
      ["Fix", "fix"],
      [" FIX ", "fix"],
      ["wontfix", "wontfix"],
      ["won't fix", "wontfix"],
      ["wont_fix", "wontfix"],
      ["WontFix", "wontfix"],
    ] as const) {
      expect(normalizeDisposition(raw)).toBe(expected);
    }
    for (const bad of ["accept", "will fix", "", "   ", "fix it", 1, null, undefined]) {
      expect(normalizeDisposition(bad)).toBeNull();
    }

    const mixedCase = validRecord();
    (mixedCase.findings as Record<string, unknown>[])[0]!.disposition = "Fix";
    const r = validateVerdictRecord(mixedCase);
    if (!r.ok) throw new Error('"Fix" must validate');
    expect(r.value.findings[0]?.disposition).toBe("fix");

    const unknown = validRecord();
    (unknown.findings as Record<string, unknown>[])[0]!.disposition = "maybe later";
    const r2 = validateVerdictRecord(unknown);
    if (r2.ok) throw new Error("unknown disposition must be rejected");
    // the error lists the enum
    expect(r2.errors.join("; ")).toContain("fix | wontfix");
  });

  test("rejects duplicate finding ids and bad evidence spans", () => {
    const dupIds = validRecord();
    (dupIds.findings as Record<string, unknown>[])[1]!.finding_id = "F1";
    expect(validateVerdictRecord(dupIds).ok).toBe(false);

    // end_line < start_line (the snippet is present, so only the span order can reject it)
    const inverted = validRecord();
    (inverted.findings as Record<string, unknown>[])[0]!.evidence_span = {
      start_line: 9,
      end_line: 4,
      snippet: "user.name as any",
    };
    const r1 = validateVerdictRecord(inverted);
    if (r1.ok) throw new Error("end_line < start_line must be rejected");
    expect(r1.errors.join("; ")).toContain("end_line must be >= start_line");

    // non-positive line (snippet present, so only the line number can reject it)
    const zero = validRecord();
    (zero.findings as Record<string, unknown>[])[0]!.evidence_span = {
      start_line: 0,
      end_line: 3,
      snippet: "user.name as any",
    };
    const r2 = validateVerdictRecord(zero);
    if (r2.ok) throw new Error("non-positive line must be rejected");
    expect(r2.errors.join("; ")).toContain("start_line");
  });

  test("rejects non-object input and wrong scalar types", () => {
    expect(validateVerdictRecord(null).ok).toBe(false);
    expect(validateVerdictRecord("verdict").ok).toBe(false);
    expect(validateVerdictRecord([]).ok).toBe(false);

    // non-integer round
    const wrongTypes = validRecord();
    wrongTypes.round = "2";
    expect(validateVerdictRecord(wrongTypes).ok).toBe(false);
  });

  test("validateFinding reports all finding-level errors with a path", () => {
    const result = validateFinding(
      { finding_id: "", severity: "mega", description: "", evidence_span: "nowhere", disposition: "" },
      "findings[3]",
    );
    if (result.ok) throw new Error("bad finding must be rejected");
    const joined = result.errors.join("; ");
    // error paths are prefixed
    expect(joined).toContain("findings[3]");
    for (const field of ["finding_id", "severity", "disposition", "description", "evidence_span"]) {
      expect(joined).toContain(field);
    }
  });
});
