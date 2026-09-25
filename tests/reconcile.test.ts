import { describe, expect, test } from "bun:test";
import {
  commitObjectReadable,
  isCommittedDisposition,
  mergeLeaseIntoIntegration,
  operationId,
  reconcile,
  type CompletionMarker,
  type KeyedCommit,
} from "../src/git/worktree.js";

const committedMarker = (round: number, opId: string, hash = "tree-hash"): CompletionMarker => ({
  round,
  disposition: `committed:${opId}`,
  content_hash: hash,
});

const keyed = (opId: string): KeyedCommit => ({
  opId,
  sha: "abc123",
  contentHash: "tree-hash",
  branch: `lease/src__a.php/1`,
});

describe("reconcile — full decision table (plan §State ownership)", () => {
  const opId = operationId("src/a.php", 1);

  test("row 1: marker(committed) + keyed + clean → skipped, terminal", () => {
    const r = reconcile({
      marker: committedMarker(1, opId),
      keyed: keyed(opId),
      worktree: { clean: true, commitObjectReadable: true },
    });
    expect(r.kind).toBe("skipped");
  });

  test("row 2: marker(committed) + keyed + dirty (object readable) → skipped (restore from keyed commit)", () => {
    const r = reconcile({
      marker: committedMarker(1, opId),
      keyed: keyed(opId),
      worktree: { clean: false, commitObjectReadable: true },
    });
    expect(r.kind).toBe("skipped");
    expect(r.reason).toContain("restored");
  });

  test("row 2 variant: committed marker + unreadable commit object → poisoned", () => {
    const r = reconcile({
      marker: committedMarker(1, opId),
      keyed: keyed(opId),
      worktree: { clean: false, commitObjectReadable: false },
    });
    expect(r.kind).toBe("poisoned");
  });

  test("row 3: marker(committed) but commit unfindable on ANY branch → poisoned (provenance failure)", () => {
    const r = reconcile({
      marker: committedMarker(1, opId),
      keyed: undefined,
      worktree: { clean: true, commitObjectReadable: true },
    });
    expect(r.kind).toBe("poisoned");
    expect(r.reason).toContain("provenance failure");
  });

  test("row 4: marker(no-op) + keyed absent → skipped; caller asserts integrated content", () => {
    const r = reconcile({
      marker: { round: 1, disposition: "no-op-empty-diff", content_hash: "t" },
      keyed: undefined,
      worktree: { clean: true, commitObjectReadable: true },
    });
    expect(r.kind).toBe("skipped");
    expect(r.reason).toContain("no-op");
  });

  test("row 4 variant: marker(no-op) but keyed commit exists → poisoned (disposition mismatch)", () => {
    const r = reconcile({
      marker: { round: 1, disposition: "no-op-empty-diff", content_hash: "t" },
      keyed: keyed(opId),
      worktree: { clean: true, commitObjectReadable: true },
    });
    expect(r.kind).toBe("poisoned");
  });

  test("row 5: marker absent + keyed + clean → skipped with backfill marker", () => {
    const r = reconcile({
      marker: undefined,
      keyed: keyed(opId),
      worktree: { clean: true, commitObjectReadable: true },
    });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") {
      expect(r.backfillMarker?.disposition).toBe(`committed:${opId}`);
      expect(r.backfillMarker?.content_hash).toBe("tree-hash");
    }
  });

  test("row 6: marker absent + keyed + dirty → skipped (reset to keyed commit) with backfill", () => {
    const r = reconcile({
      marker: undefined,
      keyed: keyed(opId),
      worktree: { clean: false, commitObjectReadable: true },
    });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") expect(r.reason).toContain("reset to keyed commit");
  });

  test("row 6 variant: keyed present but object unreadable → poisoned", () => {
    const r = reconcile({
      marker: undefined,
      keyed: keyed(opId),
      worktree: { clean: false, commitObjectReadable: false },
    });
    expect(r.kind).toBe("poisoned");
  });

  test("row 7: marker absent + keyed absent + dirty → redone (reset to lease-base)", () => {
    const r = reconcile({
      marker: undefined,
      keyed: undefined,
      worktree: { clean: false, commitObjectReadable: true },
    });
    expect(r).toEqual({ kind: "redone", resetTo: "lease-base", reason: expect.any(String) });
  });

  test("row 8: marker absent + keyed absent + clean → redone", () => {
    const r = reconcile({
      marker: undefined,
      keyed: undefined,
      worktree: { clean: true, commitObjectReadable: true },
    });
    expect(r.kind).toBe("redone");
  });

  test("disposition type guard distinguishes committed from no-op", () => {
    expect(isCommittedDisposition(committedMarker(1, opId))).toBe(true);
    expect(
      isCommittedDisposition({ round: 1, disposition: "no-op-empty-diff", content_hash: "t" }),
    ).toBe(false);
  });

  test("operationId is the stable identity (file + round)", () => {
    expect(operationId("src/a.php", 3)).toBe("src/a.php#3");
    expect(operationId("src/a.php", 3)).toBe(operationId("src/a.php", 3));
  });
});

describe("reconcile — helpers not requiring git", () => {
  test("commitObjectReadable returns false for a bogus sha without throwing", async () => {
    // A non-repo cwd makes every object unreadable; must not throw.
    const readable = await commitObjectReadable("/tmp", "0".repeat(40));
    expect(readable).toBe(false);
  });

  test("mergeLeaseIntoIntegration surfaces git failure as thrown GitError", async () => {
    // Non-repo cwd: expect rejection, not a silent pass.
    let threw = false;
    try {
      await mergeLeaseIntoIntegration("/tmp", "/tmp/nope-itg", "lease/none/1");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
