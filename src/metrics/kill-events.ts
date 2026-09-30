/**
 * Kill-event sidecar reader (data contract B).
 *
 * The chaos harness appends JSON lines to `metrics/kill-events.jsonl`:
 *   {"kind":"intent",    run_id, flow_run_id?, utc, monotonic_ms, target_pids, signal, reason}
 *   {"kind":"completed", run_id, flow_run_id?, utc, monotonic_ms, killed_pids, notes, fired}
 * The renderer consumes the normalized {@link KillEventsFile}
 * (`kind: "kill-intent" | "kill-completed"`). This module is the ONE parser
 * between them:
 *
 * - both kind spellings are accepted (`intent|kill-intent`,
 *   `completed|kill-completed`);
 * - both file shapes are accepted: JSON lines (also when the file carries the
 *   legacy `.json` name) and a whole `{run_id, events}` document;
 * - malformed lines are COUNTED and described, never silently dropped;
 * - when run ids are given, only events anchored to one of them
 *   (`flow_run_id` or `run_id`) are kept — an append-only sidecar reused
 *   across runs must not leak earlier kills into this report — and the
 *   excluded count is reported;
 * - a completion that killed nothing (`fired: false`, or an empty
 *   `killed_pids`) is a NO-OP, never a successful kill-and-resume.
 *
 * Pure (no I/O) except {@link readKillEventsFile}.
 */
import { existsSync, readFileSync } from "node:fs";

import { isFiredKill, type KillEventDiagnostics, type KillEventsFile, type ReportKillEvent } from "./types.js";

export { isFiredKill };

/** Default sidecar location, relative to the cwd (the repo's /metrics/ dir is gitignored run output). */
export const DEFAULT_KILL_EVENTS_PATH = "metrics/kill-events.jsonl";

/** How many malformed-line descriptions the diagnostics keep. */
const MAX_MALFORMED_EXAMPLES = 3;

export interface KillEventParseOptions {
  /**
   * Keep only events anchored to one of these ids (an event's `flow_run_id`
   * or `run_id`). Pass the flow's run ids (first + current run) and flow id.
   * Undefined or empty keeps every event.
   */
  matchIds?: readonly string[];
}

export interface MalformedKillEventLine {
  /** 1-based line number (document-shape events use their array index + 1). */
  line: number;
  reason: string;
}

export interface KillEventsParseResult {
  /** Normalized events, in file order. */
  events: ReportKillEvent[];
  malformed: MalformedKillEventLine[];
  /** Valid events dropped by the run filter. */
  excluded: number;
}

interface NormalizedEntry {
  event: ReportKillEvent;
  /** Ids this event is anchored to (flow_run_id, run_id). */
  anchors: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

function normalizeEvent(
  raw: unknown,
  defaultRunId: string | null,
): NormalizedEntry | { error: string } {
  const rec = asRecord(raw);
  if (rec === null) return { error: "not a JSON object" };
  const rawKind = rec.kind;
  const kind =
    rawKind === "intent" || rawKind === "kill-intent"
      ? "intent"
      : rawKind === "completed" || rawKind === "kill-completed"
        ? "completed"
        : null;
  if (kind === null) return { error: `unknown kind ${JSON.stringify(rawKind ?? null)}` };

  const flowRunId = typeof rec.flow_run_id === "string" && rec.flow_run_id !== "" ? rec.flow_run_id : null;
  const ownRunId = typeof rec.run_id === "string" && rec.run_id !== "" ? rec.run_id : null;
  const runId = ownRunId ?? flowRunId ?? defaultRunId;
  if (runId === null) return { error: "missing run_id" };
  if (typeof rec.utc !== "string" || rec.utc === "") return { error: "missing utc" };
  if (typeof rec.monotonic_ms !== "number" || !Number.isFinite(rec.monotonic_ms)) {
    return { error: "missing monotonic_ms" };
  }
  const anchors = [flowRunId, ownRunId ?? defaultRunId].filter((a): a is string => a !== null);

  if (kind === "intent") {
    return {
      event: {
        kind: "kill-intent",
        run_id: runId,
        utc: rec.utc,
        monotonic_ms: rec.monotonic_ms,
        target_pids: numberArray(rec.target_pids) ?? [],
      },
      anchors,
    };
  }

  const killedPids = numberArray(rec.killed_pids);
  const note =
    typeof rec.notes === "string" ? rec.notes : typeof rec.note === "string" ? rec.note : null;
  const fired =
    typeof rec.fired === "boolean" ? rec.fired : killedPids !== null ? killedPids.length > 0 : undefined;
  return {
    event: {
      kind: "kill-completed",
      run_id: runId,
      utc: rec.utc,
      monotonic_ms: rec.monotonic_ms,
      // "resumed" is a post-kill fact the driver supplies; a no-op never resumed.
      resumed: fired === false ? false : rec.resumed === true,
      note,
      ...(killedPids !== null ? { killed_pids: killedPids } : {}),
      ...(fired !== undefined ? { fired } : {}),
    },
    anchors,
  };
}

/** Parses sidecar text (JSON lines, or a whole `{run_id, events}` document). */
export function parseKillEvents(
  text: string,
  options: KillEventParseOptions = {},
): KillEventsParseResult {
  const entries: NormalizedEntry[] = [];
  const malformed: MalformedKillEventLine[] = [];
  const consume = (raw: unknown, line: number, defaultRunId: string | null): void => {
    const out = normalizeEvent(raw, defaultRunId);
    if ("error" in out) malformed.push({ line, reason: out.error });
    else entries.push(out);
  };

  const trimmed = text.trim();
  let parsedWhole = false;
  if (trimmed.startsWith("{")) {
    try {
      const doc = asRecord(JSON.parse(trimmed));
      if (doc !== null && Array.isArray(doc.events)) {
        const docRunId = typeof doc.run_id === "string" && doc.run_id !== "" ? doc.run_id : null;
        doc.events.forEach((e, i) => consume(e, i + 1, docRunId));
        parsedWhole = true;
      } else if (doc !== null) {
        consume(doc, 1, null);
        parsedWhole = true;
      }
    } catch {
      // Several lines of JSON: fall through to JSON-lines parsing.
    }
  }
  if (!parsedWhole) {
    text.split("\n").forEach((line, i) => {
      if (line.trim() === "") return;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        malformed.push({ line: i + 1, reason: "unparsable JSON" });
        return;
      }
      consume(raw, i + 1, null);
    });
  }

  const matchIds = options.matchIds ?? [];
  const kept =
    matchIds.length === 0
      ? entries
      : entries.filter((e) => e.anchors.some((a) => matchIds.includes(a)));
  return {
    events: kept.map((e) => e.event),
    malformed,
    excluded: entries.length - kept.length,
  };
}

/** Reads and parses a sidecar file. Throws (ENOENT etc.) when the file cannot be read. */
export function readKillEventsFile(
  path: string,
  options: KillEventParseOptions = {},
): KillEventsParseResult {
  return parseKillEvents(readFileSync(path, "utf8"), options);
}

/** The renderer's KillEventsFile for a parse result, or null when no event survived. */
export function killEventsFileOf(result: KillEventsParseResult, runId: string): KillEventsFile | null {
  return result.events.length > 0 ? { run_id: runId, events: result.events } : null;
}

/** Report diagnostics for a parse result; null when the sidecar was clean. */
export function killEventDiagnosticsOf(result: KillEventsParseResult): KillEventDiagnostics | null {
  if (result.malformed.length === 0 && result.excluded === 0) return null;
  return {
    malformed_lines: result.malformed.length,
    malformed_examples: result.malformed
      .slice(0, MAX_MALFORMED_EXAMPLES)
      .map((m) => `line ${m.line}: ${m.reason}`),
    excluded_events: result.excluded,
  };
}

export interface LoadKillEventsInput {
  /** `--kill-events` / `--events` value; undefined = use the default path when present. */
  explicitPath: string | undefined;
  /** Ids of the flow being rendered (run ids + flow id); filters other runs' kills out. */
  matchIds: readonly string[];
  /** Disable the run filter (`--all-runs`): keep every well-formed event. */
  allRuns?: boolean;
  /** run_id of the returned KillEventsFile. */
  runId: string;
  /** Default sidecar path (tests override). */
  defaultPath?: string;
}

export interface LoadedKillEvents {
  file: KillEventsFile | null;
  diagnostics: KillEventDiagnostics | null;
  /** The path that was read; null when no sidecar was given and the default does not exist. */
  path: string | null;
}

/**
 * Driver entry: resolves the sidecar path (explicit flag wins, else the
 * default when it exists), reads it and parses with the run filter.
 *
 * An explicitly given path that does not exist is an ERROR (a typo must not
 * read as "no kills recorded"); a missing DEFAULT path is simply no sidecar.
 */
export function loadKillEvents(input: LoadKillEventsInput): LoadedKillEvents {
  const defaultPath = input.defaultPath ?? DEFAULT_KILL_EVENTS_PATH;
  let path: string;
  if (input.explicitPath !== undefined) {
    if (!existsSync(input.explicitPath)) {
      throw new Error(`kill-events sidecar not found: ${input.explicitPath}`);
    }
    path = input.explicitPath;
  } else if (existsSync(defaultPath)) {
    path = defaultPath;
  } else {
    return { file: null, diagnostics: null, path: null };
  }
  const result = readKillEventsFile(path, {
    ...(input.allRuns === true ? {} : { matchIds: input.matchIds }),
  });
  return {
    file: killEventsFileOf(result, input.runId),
    diagnostics: killEventDiagnosticsOf(result),
    path,
  };
}

/** Sets `resumed` on every FIRED completion (a no-op completion never resumed). */
export function withResumed(
  file: KillEventsFile | null,
  resumedFor: (completion: Extract<ReportKillEvent, { kind: "kill-completed" }>) => boolean,
): KillEventsFile | null {
  if (file === null) return null;
  return {
    ...file,
    events: file.events.map((e) =>
      e.kind === "kill-completed" && isFiredKill(e) ? { ...e, resumed: resumedFor(e) } : e,
    ),
  };
}
