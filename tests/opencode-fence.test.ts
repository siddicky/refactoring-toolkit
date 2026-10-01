/**
 * Session fencing (audit C19): OpencodeHarness.abortSessionsNotTagged over a
 * session-list double. The REAL predicate runs — the old implementation
 * tested `title.includes("#<epoch>")`, which matched the ROUND segment of a
 * stale label (`porting-kit:a.php#2#1` survived recovery to epoch 2), matched
 * prefixes of longer epochs (`#12` for epoch 1), and aborted every
 * non-toolkit session on the server.
 *
 * Labels are built with the real fenceLabel() so the test tracks the writer.
 */

import { describe, expect, test } from "bun:test";
import {
  OpencodeHarness,
  PORTING_KIT_LABEL_PREFIX,
  fenceLabel,
  parseFenceLabel,
} from "../src/harness/opencode.js";

interface FenceDouble {
  harness: OpencodeHarness;
  /** Session ids the harness asked the server to abort, in call order. */
  abortCalls: string[];
}

/** SDK-boundary double: `session.list` returns the given titles, abort is always accepted, nothing is busy. */
function sessionListDouble(titles: readonly string[]): FenceDouble {
  const abortCalls: string[] = [];
  const client = {
    session: {
      list: async () => ({ data: titles.map((title, i) => ({ id: `s${i}`, title })) }),
      abort: async (args: { path: { id: string } }) => {
        abortCalls.push(args.path.id);
        return { data: true };
      },
      status: async () => ({ data: {} }),
    },
  } as never;
  return { harness: new OpencodeHarness(client), abortCalls };
}

/** Titles of the sessions that were aborted, given the double's ids. */
function abortedTitles(titles: readonly string[], abortedIds: readonly string[]): string[] {
  return abortedIds.map((id) => titles[Number(id.slice(1))] as string);
}

describe("parseFenceLabel", () => {
  test("round-trips fenceLabel, including slashes, :fixer and :queuefix files", () => {
    expect(parseFenceLabel(fenceLabel("src/a.php", 3, 2))).toEqual({
      file: "src__a.php",
      round: 3,
      epoch: 2,
    });
    expect(parseFenceLabel(fenceLabel("src/a.php:fixer", 1, 12))).toEqual({
      file: "src__a.php:fixer",
      round: 1,
      epoch: 12,
    });
    expect(parseFenceLabel(fenceLabel("src/a.php:queuefix", 0, 1))).toEqual({
      file: "src__a.php:queuefix",
      round: 0,
      epoch: 1,
    });
  });

  test("a '#' inside the file name does not confuse the trailing round/epoch", () => {
    expect(parseFenceLabel("porting-kit:src__a#b.php#4#7")).toEqual({
      file: "src__a#b.php",
      round: 4,
      epoch: 7,
    });
  });

  test("unparseable or non-toolkit titles yield null", () => {
    expect(parseFenceLabel("porting-kit:agent-roundtrip")).toBeNull();
    expect(parseFenceLabel("porting-kit:src__a.php#1")).toBeNull();
    expect(parseFenceLabel("porting-kit:src__a.php#x#2")).toBeNull();
    expect(parseFenceLabel("my interactive opencode chat")).toBeNull();
    expect(parseFenceLabel("")).toBeNull();
  });

  test("fenceLabel uses the shared prefix constant", () => {
    expect(fenceLabel("a.php", 1, 1).startsWith(PORTING_KIT_LABEL_PREFIX)).toBe(true);
  });
});

describe("abortSessionsNotTagged (epoch fence)", () => {
  test("a stale-epoch session whose ROUND equals the new epoch IS aborted (substring bug)", async () => {
    const stale = fenceLabel("src/a.php", 2, 1); // round 2, epoch 1 -> recovering to epoch 2
    const staleFixer = fenceLabel("src/a.php:fixer", 2, 1);
    const staleQueuefix = fenceLabel("src/a.php:queuefix", 2, 1);
    const current = fenceLabel("src/a.php", 1, 2);
    const titles = [stale, staleFixer, staleQueuefix, current];
    const { harness, abortCalls } = sessionListDouble(titles);

    const aborted = await harness.abortSessionsNotTagged(2);

    expect(abortedTitles(titles, aborted).sort()).toEqual([stale, staleFixer, staleQueuefix].sort());
    expect(abortCalls).not.toContain("s3");
    expect(aborted).not.toContain("s3");
  });

  test("the epoch is compared exactly: epoch 1 does not match '#12' (prefix of a longer number)", async () => {
    const epoch12 = fenceLabel("src/b.php", 1, 12);
    const epoch1 = fenceLabel("src/b.php", 1, 1);
    const round10 = fenceLabel("src/b.php", 10, 3);
    const titles = [epoch12, epoch1, round10];
    const { harness } = sessionListDouble(titles);

    const aborted = await harness.abortSessionsNotTagged(1);

    // epoch 1 is current and kept; epoch 12 and epoch 3 (round 10) are foreign.
    expect(abortedTitles(titles, aborted).sort()).toEqual([epoch12, round10].sort());
  });

  test("a session tagged with the current epoch is kept even when its round looks like another epoch", async () => {
    const titles = [fenceLabel("src/a.php", 1, 2), fenceLabel("src/a.php", 2, 2)];
    const { harness, abortCalls } = sessionListDouble(titles);

    expect(await harness.abortSessionsNotTagged(2)).toEqual([]);
    expect(abortCalls).toEqual([]);
  });

  test("non-toolkit sessions (the operator's own chats) are never aborted", async () => {
    const titles = [
      "my interactive opencode chat",
      "Refactor the billing module",
      "New session - 2026-09-30T10:00:00.000Z",
      "",
      "not-porting-kit:src__a.php#1#1",
    ];
    const { harness, abortCalls } = sessionListDouble(titles);

    expect(await harness.abortSessionsNotTagged(2)).toEqual([]);
    expect(abortCalls).toEqual([]);
  });

  test("toolkit-prefixed sessions with no parseable epoch tag are foreign (agent-roundtrip evidence session)", async () => {
    const roundtrip = "porting-kit:agent-roundtrip";
    const noEpoch = "porting-kit:src__a.php#1";
    const titles = [roundtrip, noEpoch, fenceLabel("src/a.php", 1, 2)];
    const { harness } = sessionListDouble(titles);

    const aborted = await harness.abortSessionsNotTagged(2);

    expect(abortedTitles(titles, aborted).sort()).toEqual([noEpoch, roundtrip].sort());
  });

  test("sessions that refuse to die are not reported as aborted", async () => {
    const stale = fenceLabel("src/a.php", 1, 1);
    const stubborn = fenceLabel("src/b.php", 1, 1);
    const client = {
      session: {
        list: async () => ({
          data: [
            { id: "gone", title: stale },
            { id: "stuck", title: stubborn },
          ],
        }),
        abort: async () => ({ data: true }),
        // "stuck" stays busy through every abort+confirm attempt.
        status: async () => ({ data: { stuck: { type: "busy" } } }),
      },
    } as never;

    expect(await new OpencodeHarness(client).abortSessionsNotTagged(2)).toEqual(["gone"]);
  });
});
