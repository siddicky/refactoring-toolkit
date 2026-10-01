/**
 * Query-layer tests (C63): the source-control porcelain/log parsers, the real
 * `gitQueries` against a scratch repository, and the kill-event / burn-down
 * multi-file source readers.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execTool } from "../exec.js";
import {
  gitQueries,
  parseGitLog,
  parseWorktreePorcelain,
  readBurnDownSources,
  readKillEventSources,
} from "./queries.js";

// Field/record separators of the log format (queries.ts LOG_SEP / LOG_REC).
const FS = "\x1f";
const RS = "\x1e";
const record = (fields: string[]) => fields.join(FS) + RS;

describe("parseGitLog (C63)", () => {
  const sha1 = "9f1c0deadc0ffee000000000000000000000001";
  const sha2 = "393798583a050dc2376c98ef72f61ff0fc65503b";

  test("parses fields and the Operation-ID / Content-Hash trailers from the body", () => {
    const out =
      record([
        sha1,
        "9f1c0de",
        "porting-toolkit",
        "2026-09-25T21:27:00+00:00",
        "porting-toolkit: port src/Money.php (round 1)",
        "lease/src__Money.php/1, integration",
        "Body paragraph.\n\nOperation-ID: src/Money.php#1\nContent-Hash: aaa111bbb222",
      ]) +
      "\n" +
      record([sha2, "3937985", "fixture", "2026-09-25T21:20:00+00:00", "fixture init", "HEAD -> main", ""]);
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: sha1,
      shortSha: "9f1c0de",
      author: "porting-toolkit",
      subject: "porting-toolkit: port src/Money.php (round 1)",
      refs: "lease/src__Money.php/1, integration",
      opId: "src/Money.php#1",
      contentHash: "aaa111bbb222",
    });
    // No trailers: null, never an empty string.
    expect(commits[1]).toMatchObject({ sha: sha2, opId: null, contentHash: null, refs: "HEAD -> main" });
  });

  test("tolerates indented trailers, leading newlines between records, and subjects containing separators-like text", () => {
    const out =
      "\n\n" +
      record([sha1, "9f1c0de", "a", "d", "fix: a | b; c", "", "   Operation-ID:   x#2   "]) +
      "\n" +
      record([sha2, "3937985", "a", "d", "s", "", ""]);
    const commits = parseGitLog(out);
    expect(commits.map((c) => c.opId)).toEqual(["x#2", null]);
    expect(commits[0]?.subject).toBe("fix: a | b; c");
  });

  test("skips junk records and short records without crashing", () => {
    const out = `${record(["not-a-sha", "x"])}${record([sha1])}\n${RS}${record([sha2, "3937985"])}`;
    const commits = parseGitLog(out);
    expect(commits.map((c) => c.sha)).toEqual([sha1, sha2]);
    expect(commits[0]).toMatchObject({ shortSha: sha1.slice(0, 7), author: "", subject: "", opId: null });
  });

  test("empty output is an empty list", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});

describe("parseWorktreePorcelain (C63)", () => {
  test("parses main, linked, detached, bare, locked and prunable records without bleeding fields across records", () => {
    const out = [
      "worktree /repo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/src__Money.php-1",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/lease/src__Money.php/1",
      "",
      "worktree /repo/.worktrees/detached-one",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "locked reason: in use",
      "",
      "worktree /repo/.worktrees/gone",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/lease/gone/1",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /srv/bare.git",
      "bare",
      "",
    ].join("\n");
    expect(parseWorktreePorcelain(out)).toEqual([
      { path: "/repo", head: "1".repeat(40), branch: "refs/heads/main" },
      { path: "/repo/.worktrees/src__Money.php-1", head: "2".repeat(40), branch: "refs/heads/lease/src__Money.php/1" },
      { path: "/repo/.worktrees/detached-one", head: "3".repeat(40), branch: "(detached)" },
      { path: "/repo/.worktrees/gone", head: "4".repeat(40), branch: "refs/heads/lease/gone/1" },
      { path: "/srv/bare.git", head: "", branch: "(bare)" },
    ]);
  });

  test("a final record without a trailing blank line is kept; empty output is empty", () => {
    expect(parseWorktreePorcelain("worktree /a\nHEAD abc\nbranch refs/heads/x")).toEqual([
      { path: "/a", head: "abc", branch: "refs/heads/x" },
    ]);
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("gitQueries against a real scratch repository (C63)", () => {
  let dir = "";
  let repo = "";
  const gitIn = (cwd: string, args: string[]) =>
    execTool("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args]);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dash-git-"));
    repo = join(dir, "repo");
    await mkdir(repo);
    await gitIn(repo, ["init", "-q", "-b", "main"]);
    await writeFile(join(repo, "a.txt"), "a\n");
    await gitIn(repo, ["add", "."]);
    await gitIn(repo, ["commit", "-q", "-m", "first", "-m", "Operation-ID: src/A.php#1\nContent-Hash: abc123"]);
    await gitIn(repo, ["worktree", "add", "-q", "--detach", join(dir, "wt-detached")]);
    await gitIn(repo, ["worktree", "add", "-q", "-b", "lease/x/1", join(dir, "wt-lease")]);
    await writeFile(join(dir, "wt-lease", "dirty.txt"), "uncommitted\n");
  });
  afterAll(async () => {
    if (dir.length > 0) await rm(dir, { recursive: true, force: true });
  });

  test("logAll returns commits with the trailers parsed", async () => {
    const res = await gitQueries("git").logAll(repo, 10);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]).toMatchObject({ subject: "first", opId: "src/A.php#1", contentHash: "abc123" });
  });

  test("worktrees reports detached HEADs as '(detached)' and per-worktree cleanliness", async () => {
    const res = await gitQueries("git").worktrees(repo);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byName = (suffix: string) => res.value.find((w) => w.path.endsWith(suffix));
    expect(byName("/repo")?.branch).toBe("refs/heads/main");
    expect(byName("wt-detached")?.branch).toBe("(detached)");
    expect(byName("wt-detached")?.clean).toBe(true);
    expect(byName("wt-lease")?.branch).toBe("refs/heads/lease/x/1");
    expect(byName("wt-lease")?.clean).toBe(false); // the untracked file
  });

  test("a missing repo is an error result, not a throw", async () => {
    const res = await gitQueries("git").logAll(join(dir, "does-not-exist"), 5);
    expect(res.ok).toBe(false);
  });
});

describe("readKillEventSources / readBurnDownSources (C63)", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dash-sources-"));
  });
  afterAll(async () => {
    if (dir.length > 0) await rm(dir, { recursive: true, force: true });
  });

  const intent = (runId: string, utc: string) =>
    JSON.stringify({ kind: "intent", run_id: runId, utc, monotonic_ms: 1, target_pids: [1], signal: "SIGKILL", reason: "t" });

  test("kill sources: absent files are skipped silently, present ones are scanned and merged", async () => {
    const a = join(dir, "kill-a.jsonl");
    const legacy = join(dir, "kill-legacy.json"); // legacy name, JSON-lines content (contract B)
    await writeFile(a, `${intent("r1", "2026-09-26T10:00:00.000Z")}\n`, "utf8");
    await writeFile(legacy, `${intent("r2", "2026-09-26T11:00:00.000Z")}\n${intent("r3", "2026-09-26T12:00:00.000Z")}\n`, "utf8");
    const res = await readKillEventSources([a, join(dir, "absent.jsonl"), legacy]);
    expect(res.errors).toEqual([]);
    expect([...res.scanned].sort()).toEqual([a, legacy].sort());
    expect(res.events.map((e) => e.runId).sort()).toEqual(["r1", "r2", "r3"]);
  });

  test("kill sources: a path that exists but cannot be read is reported as an error, not dropped", async () => {
    const asDir = join(dir, "a-directory.jsonl");
    await mkdir(asDir);
    const res = await readKillEventSources([asDir]);
    expect(res.scanned).toEqual([asDir]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.path).toBe(asDir);
    expect(res.events).toEqual([]);
  });

  test("kill sources: no paths / only absent paths scan nothing", async () => {
    expect(await readKillEventSources([])).toEqual({ events: [], errors: [], scanned: [] });
    expect((await readKillEventSources([join(dir, "nope.jsonl")])).scanned).toEqual([]);
  });

  test("burn-down sources: json array + jsonl merge; junk, absent files and unknown queues are skipped", async () => {
    const arr = join(dir, "burn.json");
    const lines = join(dir, "burn.jsonl");
    await writeFile(
      arr,
      JSON.stringify([
        { queue: "tsc", file: null, iteration: 1, error_count: 4, recorded_at: "2026-09-26T10:00:00Z", tsc: { state: "ran", reason: null, exit_code: 2, unlocated: 0 } },
        { queue: "eslint", iteration: 1, error_count: 9 },
      ]),
      "utf8",
    );
    await writeFile(
      lines,
      `{"queue":"vitest","file":null,"iteration":1,"error_count":0,"recorded_at":"2026-09-26T10:01:00Z","vitest":{"state":"not-run","reason":"runner unavailable","passed":null,"failed":null,"total":null}}\nnot json\n`,
      "utf8",
    );
    const samples = await readBurnDownSources([arr, join(dir, "absent.json"), lines]);
    expect(samples).toHaveLength(2);
    expect(samples.find((s) => s.queue === "tsc")?.tsc?.state).toBe("ran");
    expect(samples.find((s) => s.queue === "vitest")?.vitest?.state).toBe("not-run");
  });
});
