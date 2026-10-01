/**
 * B13: `worker --fault` / PORTING_KIT_FAULT validation. A fault is armed by an
 * exact `<kind>:<target>` string, so a typo (or a probe-flow fault given to the
 * port flows) armed nothing and a kill rehearsal passed vacuously. The worker
 * now refuses a spec that can never fire, against one table of fault kinds that
 * the probe flows and the port flows share (C49: the probe copy of the matcher
 * and of the crash helper is gone).
 */

import { describe, expect, test } from "bun:test";

import { FAULT_KINDS, faultKindsUsage, faultSpecProblem } from "../flows/runtime-hooks.js";
import { CLI_EXIT } from "../src/cli/args.js";
import { productionSources, readSource } from "./support/source-files.js";
import { isolatedEnv } from "./support/env.js";
import { REPO_ROOT } from "./support/paths.js";
import { join } from "node:path";

describe("faultSpecProblem", () => {
  test("every documented spec is accepted for the flows it belongs to", () => {
    expect(faultSpecProblem("commit:post-commit:src/a.php#1", "probe")).toBeNull();
    expect(faultSpecProblem("agent-write:mid:src/Pricing/Flat.php#12", "probe")).toBeNull();
    expect(faultSpecProblem("queue-verify:inject-error:seed", "port")).toBeNull();
    expect(faultSpecProblem("symbol-table:post:seed", "port")).toBeNull();
  });

  test("a typo in the kind is rejected, with the list of real kinds", () => {
    const problem = faultSpecProblem("commit:postcommit:src/a.php#1", "probe");
    expect(problem).toContain('unknown fault "commit:postcommit:src/a.php#1"');
    for (const k of FAULT_KINDS) expect(problem).toContain(`${k.kind}:${k.target}`);
  });

  test("a real kind with a malformed target is rejected (the round is required and positive)", () => {
    for (const spec of ["commit:post-commit:src/a.php", "commit:post-commit:src/a.php#", "commit:post-commit:src/a.php#0", "commit:post-commit:src/a.php#x", "commit:post-commit:#1"]) {
      expect([spec, faultSpecProblem(spec, "probe")?.includes("takes the target <file>#<round>")]).toEqual([spec, true]);
    }
    expect(faultSpecProblem("queue-verify:inject-error:other", "port")).toContain('takes the target seed (got "other")');
  });

  test("a fault of the other flows is rejected: it would never fire", () => {
    expect(faultSpecProblem("commit:post-commit:src/a.php#1", "port")).toContain("belongs to the probe flows");
    expect(faultSpecProblem("symbol-table:post:seed", "probe")).toContain("belongs to the port flows");
  });

  test("the usage text lists every kind with its flows", () => {
    for (const k of FAULT_KINDS) expect(faultKindsUsage()).toContain(`${k.kind}:${k.target} (--flows ${k.flows}:`);
  });
});

describe("the table is the code's fault points (drift guard)", () => {
  test("every kind the flows and scripts match on is in FAULT_KINDS, and every kind in the table is matched somewhere", () => {
    const matched = new Set<string>();
    for (const rel of productionSources("flows", "scripts", "src")) {
      for (const m of readSource(rel).matchAll(/\bfaultMatches\(\s*"([^"]+)"/g)) {
        if (rel !== "flows/runtime-hooks.ts") matched.add(m[1] ?? "");
      }
    }
    expect([...matched].sort()).toEqual(FAULT_KINDS.map((k) => k.kind).sort());
  });

  test("there is one matcher and one crash helper: the probe flows no longer carry their own", () => {
    const probe = readSource("scripts/probe-flow.ts");
    expect(probe).not.toMatch(/function faultMatches|function crashSelf|let FAULT\b/);
    expect(probe).toContain("flows/runtime-hooks.js");
  });
});

describe("run-demo worker refuses a fault that cannot fire (exit 64, nothing started)", () => {
  async function worker(args: string[], env: Record<string, string> = {}) {
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", join(REPO_ROOT, "scripts", "run-demo.ts"), "worker", ...args],
      // Nothing listens here, and a worker that did start would connect to it.
      env: isolatedEnv({ DEX_SERVER_ADDRESS: "127.0.0.1:1", ...env }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code, stdout, stderr };
  }

  test("a typo'd --fault", async () => {
    const r = await worker(["--harness", "stub", "--fault", "commit:postcommit:src/a.php#1"]);
    expect(r.code).toBe(CLI_EXIT.usage);
    expect(r.stderr).toContain("--fault: unknown fault");
    expect(r.stdout).not.toContain("[worker]");
  });

  test("a probe-flow fault given to --flows port", async () => {
    const r = await worker(["--harness", "stub", "--flows", "port", "--fault", "commit:post-commit:src/a.php#1"]);
    expect(r.code).toBe(CLI_EXIT.usage);
    expect(r.stderr).toContain("belongs to the probe flows");
  });

  test("the same check for PORTING_KIT_FAULT", async () => {
    const r = await worker(["--harness", "stub"], { PORTING_KIT_FAULT: "nonsense" });
    expect(r.code).toBe(CLI_EXIT.usage);
    expect(r.stderr).toContain("PORTING_KIT_FAULT: unknown fault");
  });

  test("--help lists every fault kind", async () => {
    const r = await worker(["--help"]);
    expect(r.code).toBe(0);
    for (const k of FAULT_KINDS) expect(r.stdout.replace(/\s+/g, " ")).toContain(k.kind);
  });
});
