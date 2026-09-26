import { describe, expect, test } from "bun:test";
import {
  childEntryRoute,
  fileFlowId,
  planWaves,
  PARALLEL_SLOTS,
} from "../flows/port-parallel.js";

describe("planWaves (parallel dispatch prep)", () => {
  test("chunks pending files into waves of at most the pool cap", () => {
    expect(planWaves(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(planWaves(["a", "b"], 2)).toEqual([["a", "b"]]);
    expect(planWaves([], 2)).toEqual([]);
  });

  test("degenerate slot counts never widen concurrency", () => {
    expect(planWaves(["a", "b"], 0)).toEqual([["a"], ["b"]]);
    expect(planWaves(["a", "b"], -3)).toEqual([["a"], ["b"]]);
    expect(planWaves(["a"], Number.NaN)).toEqual([["a"]]);
  });

  test("PARALLEL_SLOTS is the durable WorktreePool cap (2) — never wider", () => {
    expect(PARALLEL_SLOTS).toBe(2);
  });

  test("fileFlowId is deterministic, slash-free, and round-tagged", () => {
    const a = fileFlowId("p4-7", "src/Pricing/FlatRateDiscount.php", 2);
    const b = fileFlowId("p4-7", "src/Pricing/FlatRateDiscount.php", 2);
    expect(a).toBe(b);
    expect(a).toContain("src__Pricing__FlatRateDiscount.php");
    expect(a).toContain("-r2");
    expect(a).not.toContain("/");
  });

  test("childEntryRoute: round 1 implements, fix rounds enter queue-fix", () => {
    expect(childEntryRoute({ round: 1 })).toBe("implement");
    expect(childEntryRoute({ round: 2 })).toBe("queue-fix");
    expect(childEntryRoute({ round: 3 })).toBe("queue-fix");
  });
});
