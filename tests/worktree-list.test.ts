/**
 * `git worktree list --porcelain` has ONE parser (audit C49). The dashboard's
 * worktree rows and `recover-port`'s lease selection used to parse it twice, with
 * different rules for where a record ends and how a detached HEAD is spelled.
 */

import { describe, expect, test } from "bun:test";

import { parseWorktreeList } from "../scripts/run-demo.js";
import { parseWorktreePorcelain } from "../src/dashboard/queries.js";
import { parseWorktreeRecords, shortBranchName } from "../src/git/worktree-list.js";
import { productionSources, readSource } from "./support/source-files.js";

const SHA = (c: string): string => c.repeat(40);

const PORCELAIN = [
  "worktree /repo",
  `HEAD ${SHA("1")}`,
  "branch refs/heads/main",
  "",
  "worktree /repo/.worktrees/src__a.php-1",
  `HEAD ${SHA("2")}`,
  "branch refs/heads/lease/src__a.php/1",
  "",
  "worktree /repo/.worktrees/detached-2",
  `HEAD ${SHA("3")}`,
  "detached",
  "locked reason: in use",
  "",
  "worktree /repo/.worktrees/gone",
  `HEAD ${SHA("4")}`,
  "branch refs/heads/lease/gone/1",
  "prunable gitdir file points to non-existent location",
  "",
  "worktree /srv/bare.git",
  "bare",
].join("\n");

describe("parseWorktreeRecords", () => {
  test("reads main, linked, detached, locked, prunable and bare records, and a last record with no trailing blank line", () => {
    expect(parseWorktreeRecords(PORCELAIN)).toEqual([
      { path: "/repo", head: SHA("1"), ref: "refs/heads/main", detached: false, bare: false },
      { path: "/repo/.worktrees/src__a.php-1", head: SHA("2"), ref: "refs/heads/lease/src__a.php/1", detached: false, bare: false },
      { path: "/repo/.worktrees/detached-2", head: SHA("3"), ref: null, detached: true, bare: false },
      { path: "/repo/.worktrees/gone", head: SHA("4"), ref: "refs/heads/lease/gone/1", detached: false, bare: false },
      { path: "/srv/bare.git", head: "", ref: null, detached: false, bare: true },
    ]);
  });

  test("CRLF line endings and a path with spaces are read the same way", () => {
    const records = parseWorktreeRecords(`worktree /my repo\r\nHEAD ${SHA("a")}\r\nbranch refs/heads/x\r\n\r\n`);
    expect(records).toEqual([{ path: "/my repo", head: SHA("a"), ref: "refs/heads/x", detached: false, bare: false }]);
  });

  test("empty output and stray lines before the first record give no rows", () => {
    expect(parseWorktreeRecords("")).toEqual([]);
    expect(parseWorktreeRecords("HEAD abc\nbranch refs/heads/x\n")).toEqual([]);
  });

  test("shortBranchName strips refs/heads/ only", () => {
    expect(shortBranchName("refs/heads/lease/a/1")).toBe("lease/a/1");
    expect(shortBranchName("refs/remotes/origin/main")).toBe("refs/remotes/origin/main");
  });
});

describe("both callers read the same records", () => {
  test("the dashboard rows and recovery's refs agree on every path, branch and detached HEAD", () => {
    const rows = parseWorktreePorcelain(PORCELAIN);
    const refs = parseWorktreeList(PORCELAIN);
    expect(refs.map((r) => r.path)).toEqual(rows.map((r) => r.path));
    expect(rows.map((r) => r.branch)).toEqual([
      "refs/heads/main",
      "refs/heads/lease/src__a.php/1",
      "(detached)",
      "refs/heads/lease/gone/1",
      "(bare)",
    ]);
    expect(refs.map((r) => r.branch)).toEqual(["main", "lease/src__a.php/1", null, "lease/gone/1", null]);
  });
});

describe("architecture: the porcelain format is parsed in one module", () => {
  test("only src/git/worktree-list.ts reads a `worktree <path>` line", () => {
    const parsers = productionSources("src", "scripts", "flows", "harness").filter((rel) =>
      /startsWith\("worktree "\)/.test(readSource(rel)),
    );
    expect(parsers).toEqual(["src/git/worktree-list.ts"]);
  });
});
