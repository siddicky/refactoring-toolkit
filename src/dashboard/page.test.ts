/**
 * Client-side regression tests for src/dashboard/static/index.html.
 *
 * The page keeps its CSS/JS inline (no build step), so the tests evaluate the
 * inline <script> in a node:vm sandbox with a tiny fake DOM and call the
 * render functions directly. This pins the rendering decisions (what class a
 * headline gets, what a not-run burn-down point looks like, how the usage
 * table computes cells) without a browser.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PAGE = join(dirname(fileURLToPath(import.meta.url)), "static", "index.html");

interface FakeElement {
  id: string;
  textContent: string;
  innerHTML: string;
  hidden: boolean;
  title: string;
  tBodies: Array<{ innerHTML: string }>;
  classList: {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    toggle: (name: string, force?: boolean) => void;
    contains: (name: string) => boolean;
  };
  classes: () => string[];
}

interface PageApi {
  renderHeadline(st: Record<string, unknown>): void;
  renderUsage(rows: unknown[]): void;
  renderFeed(rows: unknown[]): void;
  renderBurnDown(series: unknown[]): void;
  renderDegraded(rows: unknown[]): void;
  renderFlows(rows: unknown[]): void;
  renderKills(groups: unknown[]): void;
  poll(): Promise<void>;
}

interface LoadedPage {
  api: PageApi;
  el: (id: string) => FakeElement;
  /** Timers the page scheduled (setTimeout/setInterval), in order. */
  timers: Array<{ fn: () => void; ms: number }>;
  html: string;
  script: string;
}

function loadPage(options: { fetch?: (url: string, init?: unknown) => Promise<unknown> } = {}): LoadedPage {
  const html = readFileSync(PAGE, "utf8");
  const match = /<script>([\s\S]*)<\/script>/.exec(html);
  if (match === null || match[1] === undefined) throw new Error("index.html has no inline script");
  const script = match[1];

  const elements = new Map<string, FakeElement>();
  const el = (id: string): FakeElement => {
    let found = elements.get(id);
    if (found === undefined) {
      const classes = new Set<string>();
      found = {
        id,
        textContent: "",
        innerHTML: "",
        hidden: false,
        title: "",
        tBodies: [{ innerHTML: "" }],
        classList: {
          add: (...names) => names.forEach((n) => classes.add(n)),
          remove: (...names) => names.forEach((n) => classes.delete(n)),
          toggle: (name, force) => {
            const on = force ?? !classes.has(name);
            if (on) classes.add(name);
            else classes.delete(name);
          },
          contains: (name) => classes.has(name),
        },
        classes: () => [...classes],
      };
      elements.set(id, found);
    }
    return found;
  };

  const timers: Array<{ fn: () => void; ms: number }> = [];
  const sandbox: Record<string, unknown> = {
    document: { getElementById: (id: string) => el(id) },
    fetch: options.fetch ?? (() => new Promise(() => {})), // never settles by default
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    setInterval: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    console,
  };
  // Functions the page does not define (yet) are exported as undefined so a
  // missing feature fails its own test instead of the whole harness.
  const names = ["renderHeadline", "renderUsage", "renderFeed", "renderBurnDown", "renderDegraded", "renderFlows", "renderKills", "poll"];
  const exports = names.map((n) => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(", ");
  vm.runInNewContext(`${script}\n;globalThis.__api = { ${exports} };`, sandbox);
  return { api: sandbox.__api as PageApi, el, timers, html, script };
}

describe("feed tokens cell (C53)", () => {
  const entry = (over: Record<string, unknown>) => ({
    flowId: "cx-5",
    ts: "2026-09-26T10:00:00Z",
    startedAt: "2026-09-26T10:00:00Z",
    endedAt: null,
    stepId: "pp-implement",
    role: "agent",
    file: null,
    round: null,
    attempt: 1,
    outcome: "interrupted",
    tokens: null,
    usage: null,
    wallClockMs: null,
    tokensRequired: true,
    ...over,
  });

  test("an attempt-0 start marker renders a neutral 'start' cell, never the red MISSING provenance failure", () => {
    const page = loadPage();
    page.api.renderFeed([entry({ attempt: 0, tokensRequired: false })]);
    const html = page.el("feed").tBodies[0]?.innerHTML ?? "";
    expect(html).toContain(">start<");
    expect(html).not.toContain("MISSING");
  });

  test("a real model attempt without tokens still renders MISSING", () => {
    const page = loadPage();
    page.api.renderFeed([entry({ attempt: 1, tokensRequired: true })]);
    expect(page.el("feed").tBodies[0]?.innerHTML ?? "").toContain("MISSING");
  });
});

describe("headline styling (C54)", () => {
  test("the headline is styled from headlineState, not from regexes over the display text", () => {
    const page = loadPage();
    // The resumed text contains the word "killed": the old regex made it red.
    page.api.renderHeadline({
      headline: "◆ cx-5: 3/5 files · resumed (killed 10:30:00Z)",
      headlineState: "resumed",
      headlineDegraded: false,
    });
    const classes = page.el("headline").classes();
    expect(classes).toContain("state-resumed");
    expect(classes).not.toContain("state-killed");
    expect(page.el("headline").textContent).toContain("resumed (killed");
  });

  test("a flow id containing 'completed' does not turn a running headline green", () => {
    const page = loadPage();
    page.api.renderHeadline({
      headline: "◆ run-completed-1: 1/5 files · running",
      headlineState: "running",
      headlineDegraded: false,
    });
    expect(page.el("headline").classes()).not.toContain("state-completed");
    expect(page.el("headline").classes()).toContain("state-running");
  });

  test("completed + degraded carries the degraded class so it cannot read as a clean green", () => {
    const page = loadPage();
    page.api.renderHeadline({
      headline: "◆ cx-5: 5/5 files · completed · DEGRADED (2 unreviewed rounds)",
      headlineState: "completed",
      headlineDegraded: true,
    });
    const classes = page.el("headline").classes();
    expect(classes).toContain("degraded");
    // The stylesheet must let .degraded override the completed colour.
    const css = page.html;
    expect(css.indexOf("#headline.degraded")).toBeGreaterThan(css.indexOf("#headline.state-completed"));
  });

  test("switching from a degraded state back to a clean one removes the stale classes", () => {
    const page = loadPage();
    page.api.renderHeadline({ headline: "x", headlineState: "completed", headlineDegraded: true });
    page.api.renderHeadline({ headline: "y", headlineState: "running", headlineDegraded: false });
    const classes = page.el("headline").classes();
    expect(classes).not.toContain("degraded");
    expect(classes).not.toContain("state-completed");
  });

  test("an older server without headlineState renders unstyled (default amber), not from text", () => {
    const page = loadPage();
    page.api.renderHeadline({ headline: "◆ cx-5: 5/5 files · completed" });
    const classes = page.el("headline").classes();
    expect(classes.some((c) => c.startsWith("state-"))).toBe(false);
  });

  test("the page script no longer regexes the headline text", () => {
    const page = loadPage();
    const fn = /function renderHeadline[\s\S]*?\n}\n/.exec(page.script)?.[0] ?? "";
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).not.toMatch(/\.test\(/);
  });
});

describe("polling discipline (C58)", () => {
  const emptyState = (generatedAt: string) => ({
    generatedAt,
    headline: "",
    headlineState: "none",
    headlineDegraded: false,
    sources: {
      dex: { available: true, error: null, detail: "" },
      git: { available: true, error: null, repoRoot: "/r" },
      killEvents: { available: true, error: null, filesScanned: [] },
    },
    flows: [],
    grid: [],
    queueSummaries: [],
    feed: [],
    burnDown: [],
    commits: [],
    worktrees: [],
    killTimeline: [],
    agentUsage: [],
    degradedRounds: [],
  });

  function pollingPage() {
    const pending: Array<(state: unknown) => void> = [];
    const fetchStub = () =>
      new Promise((resolve) => {
        pending.push((state) => resolve({ ok: true, json: async () => state }));
      });
    const page = loadPage({ fetch: fetchStub });
    return { page, pending };
  }
  const flush = () => Bun.sleep(2);

  test("never has two requests in flight (a slow response is not overlapped by the next poll)", async () => {
    const { page, pending } = pollingPage();
    expect(pending).toHaveLength(1); // the load-time poll
    void page.api.poll(); // e.g. a manual call or a stray timer while the first is slow
    await flush();
    expect(pending).toHaveLength(1);
    pending[0]?.(emptyState("2026-09-28T10:00:00.000Z"));
    await flush();
    expect(page.timers).toHaveLength(1); // exactly one follow-up scheduled
  });

  test("polls with a chained timeout at the poll interval, not setInterval", async () => {
    const { page, pending } = pollingPage();
    pending[0]?.(emptyState("2026-09-28T10:00:00.000Z"));
    await flush();
    expect(page.timers[0]?.ms).toBe(2000);
    expect(/setInterval\s*\(/.test(page.script)).toBe(false);
    // the timer fires the next poll, which starts a NEW request
    page.timers[0]?.fn();
    await flush();
    expect(pending).toHaveLength(2);
  });

  test("a snapshot older than the one already rendered is dropped", async () => {
    const { page, pending } = pollingPage();
    pending[0]?.(emptyState("2026-09-28T10:00:10.000Z"));
    await flush();
    expect(page.el("generated").textContent).toContain("10:00:10");
    page.timers[0]?.fn();
    await flush();
    pending[1]?.(emptyState("2026-09-28T10:00:04.000Z")); // a stale response arriving late
    await flush();
    expect(page.el("generated").textContent).toContain("10:00:10");
    expect(page.el("generated").textContent).not.toContain("10:00:04");
  });

  test("the page poll interval matches the server cache contract", () => {
    const page = loadPage();
    expect(/const POLL_MS = (\d+);/.exec(page.script)?.[1]).toBe("2000");
  });

  test("a failed poll keeps polling (the next timeout is still scheduled)", async () => {
    const page = loadPage({ fetch: () => Promise.reject(new Error("offline")) });
    await flush();
    expect(page.timers).toHaveLength(1);
    expect(page.el("chip-api").classes()).toContain("down");
  });
});

describe("flows table stream mode (C57)", () => {
  const flow = (over: Record<string, unknown>) => ({
    flowId: "cx-5",
    flowType: "port.Project",
    status: "running",
    startTime: "2026-09-26T10:00:00Z",
    closeTime: null,
    runId: "r1",
    ...over,
  });

  test("the per-flow feed source is shown: stream, poll (fallback), or - (not followed)", () => {
    const page = loadPage();
    page.api.renderFlows([
      flow({ flowId: "a", streamMode: "stream" }),
      flow({ flowId: "b", streamMode: "poll-fallback" }),
      flow({ flowId: "c" }),
    ]);
    const html = page.el("flows").tBodies[0]?.innerHTML ?? "";
    expect(html).toContain(">stream<");
    expect(html).toContain(">poll<");
    expect(html.match(/<tr>/g)?.length).toBe(3);
    expect(page.html).toContain("<th>feed</th>");
  });
});

describe("usage table fresh input (C60)", () => {
  const usage = (over: Record<string, unknown>) => ({
    role: "review",
    calls: 2,
    input: 329_000,
    freshInput: 329_000,
    cacheRead: 576_000,
    output: 4_000,
    reasoning: 0,
    costUsd: 0,
    estimated: true,
    ...over,
  });

  test("a cache-heavy role shows its real fresh input, not a clamped 0", () => {
    const page = loadPage();
    page.api.renderUsage([usage({})]);
    const cells = [...(page.el("usage").tBodies[0]?.innerHTML ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    // role, calls, input (fresh), cache-read, output, reasoning, cost
    expect(cells[2]).toBe("329,000");
    expect(cells[3]).toBe("576,000");
  });

  test("the client never subtracts cache-read from input", () => {
    const page = loadPage();
    expect(page.script).not.toMatch(/\.input\s*-\s*\w+\.cacheRead/);
  });

  test("an older payload without freshInput falls back to input (no subtraction)", () => {
    const page = loadPage();
    const row = usage({});
    delete (row as Record<string, unknown>).freshInput;
    page.api.renderUsage([row]);
    const cells = [...(page.el("usage").tBodies[0]?.innerHTML ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    expect(cells[2]).toBe("329,000");
  });
});

describe("burn-down chart not-run points (C56)", () => {
  const series = (points: unknown[]) => [{ queue: "vitest", points }];
  const ran = { iteration: 1, errorCount: 3, recordedAt: null, state: "ran", reason: null };
  const notRun = { iteration: 2, errorCount: null, recordedAt: null, state: "not-run", reason: "runner unavailable" };

  test("a not-run point is a hollow marker with the reason, never a plotted 0", () => {
    const page = loadPage();
    page.api.renderBurnDown(series([ran, notRun]));
    const html = page.el("burndown").innerHTML;
    expect(html).toContain("runner unavailable");
    expect(html).toContain('fill="none"'); // hollow marker
    expect(html).toContain("NOT RUN");
    // The last point is not-run: the headline label must say so, not "0 errors".
    expect(html).toMatch(/latest\s*<span class="amber">NOT RUN/);
    expect(html).not.toMatch(/latest 0 errors/);
  });

  test("the polyline breaks at a not-run point (a gap, not a line to zero)", () => {
    const page = loadPage();
    const after = { iteration: 3, errorCount: 1, recordedAt: null, state: "ran", reason: null };
    page.api.renderBurnDown(series([ran, notRun, after]));
    const polylines = page.el("burndown").innerHTML.match(/<polyline /g) ?? [];
    // iteration 1 and iteration 3 are isolated single-point segments (no polyline to join them).
    expect(polylines.length).toBeLessThanOrEqual(0);
    expect(page.el("burndown").innerHTML.match(/<circle /g)?.length).toBe(3);
  });

  test("a fully ran series still draws one connected polyline", () => {
    const page = loadPage();
    const two = { iteration: 2, errorCount: 1, recordedAt: null, state: "ran", reason: null };
    page.api.renderBurnDown(series([ran, two]));
    expect(page.el("burndown").innerHTML.match(/<polyline /g)?.length).toBe(1);
  });
});

describe("degraded rounds panel (C54)", () => {
  test("lists flow, file, round, reviewers and reasons (escaped)", () => {
    const page = loadPage();
    page.api.renderDegraded([
      {
        flowId: "SubFlow:cx-9-x-0",
        file: "src/Money.php",
        round: 2,
        reviewers: ["reviewer-A", "reviewer-B"],
        reasons: ["exhausted <retries>", "timeout"],
      },
    ]);
    const html = page.el("degraded").tBodies[0]?.innerHTML ?? "";
    expect(html).toContain("src/Money.php");
    expect(html).toContain("reviewer-A");
    expect(html).toContain("exhausted &lt;retries&gt;");
    expect(page.el("degraded-empty").hidden).toBe(true);
  });

  test("no degraded rounds shows an explicit empty note", () => {
    const page = loadPage();
    page.api.renderDegraded([]);
    expect(page.el("degraded-empty").hidden).toBe(false);
    expect(page.el("degraded-empty").textContent).toContain("no degraded rounds");
  });
});
