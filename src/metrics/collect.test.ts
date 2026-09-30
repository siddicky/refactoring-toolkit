import { describe, expect, test } from "bun:test";
import {
  collectBurnDown,
  collectEnvelopes,
  collectTombstones,
  collectVerdicts,
  type StateAttribute,
} from "./collect.js";

const attr = (key: string, value: unknown): StateAttribute => ({ key, value });

describe("collectBurnDown (flow attribute rows -> renderer samples)", () => {
  test("keeps the aggregate row (file null) alongside per-file rows instead of dropping it", () => {
    // Exactly what QueueVerifyStep writes: tsc-<iter> total + per-file rows.
    const rows = collectBurnDown([
      attr("queue-burndown/tsc-1", {
        queue: "tsc",
        iteration: 1,
        error_count: 12,
        file: null,
        recorded_at: "2026-09-26T10:00:00Z",
      }),
      attr("queue-burndown/tsc-1-src__a.php", {
        queue: "tsc",
        iteration: 1,
        error_count: 7,
        file: "src/a.php",
        recorded_at: "2026-09-26T10:00:00Z",
      }),
      attr("queue-burndown/tsc-1-src__b.php", {
        queue: "tsc",
        iteration: 1,
        error_count: 5,
        file: "src/b.php",
        recorded_at: "2026-09-26T10:00:00Z",
      }),
    ]);
    expect(rows.map((r) => `${r.file}:${r.error_count}`).sort()).toEqual([
      "null:12",
      "src/a.php:7",
      "src/b.php:5",
    ]);
  });

  test("carries vitest accounting and skips malformed / foreign attributes", () => {
    const rows = collectBurnDown([
      attr("queue-burndown/vitest-1", {
        queue: "vitest",
        iteration: 1,
        error_count: 0,
        file: null,
        recorded_at: "2026-09-26T10:00:00Z",
        vitest: { state: "not-run", reason: "runner unavailable", passed: null, failed: null, total: null },
      }),
      attr("queue-burndown/bad", { queue: "tsc", iteration: "1" }),
      attr("envelope-event/x", { stepId: "s" }),
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.vitest).toEqual({
      state: "not-run",
      reason: "runner unavailable",
      passed: null,
      failed: null,
      total: null,
    });
  });
});

describe("collectVerdicts / collectTombstones / collectEnvelopes", () => {
  test("verdicts come from the ReviewTuple metrics member; tombstones from the key + value", () => {
    const metrics = {
      file: "src/a.php",
      reviewer: "reviewer-A",
      round: 1,
      diff_id: "d1",
      findings: [],
      citation_check: [],
    };
    const attrs = [
      attr("pp-verdict/src__a.php#1#reviewer-A", { metrics }),
      attr("pp-verdict/src__a.php#1#reviewer-B", {
        reviewer: "reviewer-B",
        discarded: true,
        reason: "attempt-exhausted",
        attempt: 3,
        tokens: 42,
      }),
    ];
    expect(collectVerdicts(attrs)).toEqual([metrics]);
    expect(collectTombstones(attrs)).toEqual([
      {
        file: "src/a.php",
        round: 1,
        reviewer: "reviewer-B",
        discarded: true,
        reason: "attempt-exhausted",
        attempt: 3,
        tokens: 42,
      },
    ]);
  });

  test("envelopes are validated and sorted by started_at", () => {
    const env = (stepId: string, started_at: string) => ({
      stepId,
      role: "record",
      attempt: 1,
      outcome: "completed",
      started_at,
    });
    const out = collectEnvelopes([
      attr("envelope-event/2", env("b", "2026-09-26T10:00:02Z")),
      attr("envelope-event/1", env("a", "2026-09-26T10:00:01Z")),
      attr("envelope-event/3", { stepId: "no-role" }),
    ]);
    expect(out.map((e) => e.stepId)).toEqual(["a", "b"]);
  });
});
