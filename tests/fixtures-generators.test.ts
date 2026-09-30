/**
 * Audit C65 (and the fixture-hygiene clusters that ride on it): the two
 * deterministic PHP fixture generators must reproduce the committed
 * fixtures/** trees exactly. Both generators are run into a temp dir with
 * `--out`, so the committed trees are never touched.
 *
 * Why it matters: the generators wipe their output directory before writing,
 * so any hand-added file in a generated tree (creatorex-middleware/prep-stub.md
 * was one) silently disappears on the documented regenerate command. File-set
 * equality plus byte equality catches both that and any generator/output drift.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface FixtureSpec {
  readonly name: string;
  readonly script: string;
  readonly committed: string;
}

const PHP_SAMPLE: FixtureSpec = {
  name: "php-sample",
  script: join(repoRoot, "fixtures/generate.ts"),
  committed: join(repoRoot, "fixtures/php-sample"),
};
const CREATOREX: FixtureSpec = {
  name: "creatorex-middleware",
  script: join(repoRoot, "fixtures/generate-creatorex.ts"),
  committed: join(repoRoot, "fixtures/creatorex-middleware"),
};
const SPECS: readonly FixtureSpec[] = [PHP_SAMPLE, CREATOREX];

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(abs.slice(root.length + 1).split("\\").join("/"));
    }
  };
  walk(root);
  return out.sort();
}

function runGenerator(spec: FixtureSpec, args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [spec.script, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function printedDigest(stdout: string): string {
  const match = /^DIGEST sha256: ([0-9a-f]{64})$/m.exec(stdout);
  if (match?.[1] === undefined) throw new Error(`generator printed no DIGEST line:\n${stdout}`);
  return match[1];
}

function documentedDigest(label: string): string {
  const doc = readFileSync(join(repoRoot, "fixtures/FIXTURES.md"), "utf8");
  const match = new RegExp(`^${label}:\\s+([0-9a-f]{64})$`, "m").exec(doc);
  if (match?.[1] === undefined) throw new Error(`fixtures/FIXTURES.md has no digest line for ${label}`);
  return match[1];
}

let scratch = "";
const regenerated = new Map<string, { dir: string; digest: string }>();

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "fixtures-gen-"));
  for (const spec of SPECS) {
    const dir = join(scratch, spec.name);
    const run = runGenerator(spec, ["--out", dir]);
    if (run.status !== 0) throw new Error(`${spec.name} generator failed: ${run.stderr}`);
    regenerated.set(spec.name, { dir, digest: printedDigest(run.stdout) });
  }
});

afterAll(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

describe("fixture generators reproduce the committed fixtures (audit C65)", () => {
  for (const spec of SPECS) {
    test(`${spec.name}: regeneration yields the same file set and identical bytes`, () => {
      const fresh = regenerated.get(spec.name);
      if (fresh === undefined) throw new Error("not regenerated");
      const committedFiles = listFiles(spec.committed);
      expect(listFiles(fresh.dir)).toEqual(committedFiles);
      for (const rel of committedFiles) {
        const a = readFileSync(join(fresh.dir, rel));
        const b = readFileSync(join(spec.committed, rel));
        expect(a.equals(b), `${spec.name}/${rel} differs from generator output`).toBe(true);
      }
    });

    test(`${spec.name}: printed DIGEST matches fixtures/FIXTURES.md`, () => {
      const fresh = regenerated.get(spec.name);
      expect(fresh?.digest).toBe(documentedDigest(spec.name));
    });
  }

  test("creatorex-middleware: regeneration emits prep-stub.md (used by tests and `demo --files creatorex`)", () => {
    const fresh = regenerated.get(CREATOREX.name);
    if (fresh === undefined) throw new Error("not regenerated");
    const emitted = readFileSync(join(fresh.dir, "prep-stub.md"), "utf8");
    expect(emitted).toContain("## 1. Source map");
    expect(emitted).toContain("`tests/Access/EntitlementCheckerTest.php`");
  });
});

describe("generator --out handling", () => {
  for (const spec of SPECS) {
    test(`${spec.name}: refuses to wipe a non-empty directory that lacks GENERATED.txt`, () => {
      const dir = mkdtempSync(join(scratch, "unowned-"));
      writeFileSync(join(dir, "keep.txt"), "precious\n");
      const run = runGenerator(spec, ["--out", dir]);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("refusing to wipe");
      expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("precious\n");
    });

    test(`${spec.name}: replaces a stale generated tree (marker present)`, () => {
      const dir = mkdtempSync(join(scratch, "stale-"));
      writeFileSync(join(dir, "GENERATED.txt"), "old\n");
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Stale.php"), "<?php\n");
      const run = runGenerator(spec, ["--out", dir]);
      expect(run.status).toBe(0);
      expect(existsSync(join(dir, "src", "Stale.php"))).toBe(false);
      expect(listFiles(dir)).toEqual(listFiles(spec.committed));
    });

    test(`${spec.name}: --out without a value fails instead of falling back to the committed tree`, () => {
      const run = runGenerator(spec, ["--out"]);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("--out requires a directory argument");
    });
  }
});

// ---------------------------------------------------------------------------
// Fixture test hygiene. No PHP runtime runs in this pipeline, so these are
// structural checks on the committed PHP tests: each pins an assertion that
// was hand-traced against its source and found to contradict it.
// ---------------------------------------------------------------------------

function readFixture(spec: FixtureSpec, rel: string): string {
  return readFileSync(join(spec.committed, rel), "utf8");
}

/** Source of one PHP test method: from its signature to the next public method. */
function phpMethod(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`PHP method ${name} not found`);
  const next = source.indexOf("    public function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("creatorex PHP tests agree with their sources (audit C66)", () => {
  const entitlement = readFixture(CREATOREX, "tests/Access/EntitlementCheckerTest.php");

  test("entitlement tests run against a session that satisfies the age and geo gates", () => {
    // checker() registers age+geo+entitlement gates; a bare ['user_id', 'entitled'] session
    // also fails age and geo, so the asserted reasons / allowed flag cannot hold.
    for (const name of ["testStringZeroEntitlementDeniesDespiteLookup", "testNullEntitlementFallsThroughToLookup"]) {
      const body = phpMethod(entitlement, name);
      expect(body, name).not.toMatch(/decide\(\['user_id' => 42, 'entitled' => /);
      expect(body, name).toContain("$this->session()");
    }
  });

  test("the exception test calls a method EntitlementChecker::__call really rejects", () => {
    // __call only throws for names that do not start with "require".
    const body = phpMethod(entitlement, "testUnknownGateMethodThrows");
    expect(body).toContain("expectException(\\BadMethodCallException::class)");
    const call = /->(\w+)\(\);/.exec(body);
    expect(call?.[1]).toBeDefined();
    expect(call?.[1]?.startsWith("require")).toBe(false);
  });

  test("an unknown require* gate is pinned as accepted-but-unevaluated, not as a throw", () => {
    const body = phpMethod(entitlement, "testUnknownRequireGateIsRegisteredButNeverEvaluated");
    expect(body).toContain("requireFriendInvite()");
    expect(body).not.toContain("expectException");
    expect(body).toContain("assertTrue($checker->decide([])['allowed'])");
  });

  test("money_string assertions equal a round-to-nearest of the input, not a truncation", () => {
    const helpers = readFixture(CREATOREX, "tests/Support/LegacyHelpersTest.php");
    const body = phpMethod(helpers, "testMoneyStringRoundsViaSprintf");
    const assertions = [...body.matchAll(/assertSame\('(\d+\.\d\d)', creatorex_money_string\('?(\d+(?:\.\d+)?)'?\)\)/g)];
    expect(assertions.length).toBeGreaterThanOrEqual(2);
    for (const m of assertions) {
      // None of the inputs is a binary tie, so JS toFixed agrees with PHP sprintf('%.2f').
      expect(m[1], `creatorex_money_string(${m[2]})`).toBe(Number(m[2]).toFixed(2));
    }
  });
});
