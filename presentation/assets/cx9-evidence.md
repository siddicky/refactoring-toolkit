# cx9 final validation run — live-observation evidence digest

Flow `cx9b` (id `cx9` was burned by a 41 ms config-miss dispatch — wrong prep
path — before the corrected dispatch; dex rejects duplicate flow ids).
runId `01a0e304-b36d-7edc-b52a-397d5d3c5132` → CONTINUED_AS_NEW rollover →
`453b9435-91aa-4b10-91f2-294bc31ddd9f`. **FLOW_STATUS_COMPLETED at
2026-09-27T17:48:52Z** (4 h 30 min; ~1.32 M model-role tokens incl. the
prep-generate degenerate-retry grind).

## (a) US-002 dispatch gate — CAPTURED (degraded, fail-open surfaced)

```
gate: degraded (no review-step events in cx8 history (nothing relevant to vouch on)) — dispatch protection NOT active (fail-open); proceeding WITHOUT lane-health protection
```

Full line: `presentation/assets/dispatch-gate-cx9.txt` (run twice: once as
`gate --flow-id cx8` pre-dispatch, once inside the `demo` dispatch; identical).

## (b) US-003 turn_diagnosis — CAPTURED (1 durable record)

Durable attribute `envelope-event/pp-prep-review-b#2@prep0` (parent flow):

```json
{"attempt":2,"disposition":"recorded-evidence","file":"PORTING.spec.md",
 "jev_usage":null,"lane":"demoted","model":null,"prior_failed_attempts":1,
 "recorded_at_utc":"2026-09-27T14:51:28.608Z","reviewer":"reviewer-B"}
```

The US-003 deterministic successor re-record fired live: attempt 1 of the
prep-review-b turn failed, attempt 2 (demoted lane) recorded the retry
context with zero control-flow consumers. Honest note: the run's other
ambiguous surface (pp-prep-generate attempts 1–4, all degenerate/aborted
over ~65 min) left NO durable diagnosis — those are Tier-0 throwing attempts
(0(g): a throwing attempt cannot persist), and the succeeding agent-step
envelope carries `turn_diagnosis: null` (the successor re-record is
implemented on review steps, not the prep-generate agent step).

## (c) US-007 dashboard subscriber — CAPTURED (stream mode, zero fallback)

serve-status startup line, `/tmp/metrics-cx9/serve-status-cx9.log`:

```
[serve-status] stream subscriber: up (port/<flowId>/events live feed)
[serve-status] http://127.0.0.1:4646/  (repo=/tmp/pk-cx9 dex=127.0.0.1:8801 poll=2s; Ctrl-C stops)
```

`grep -c fallback` over the full run log = **0** — the subscriber delivered
the entire run (80-event feed window, verified delivering cx9b events at
13:14–17:48 UTC) with the poll fallback never ENGAGED.

## (d) US-009/AC1 kill arc — NOT FIRED (documented, per bounds)

Three pp-queue-verify windows ran (17:24, 17:33, 17:48 UTC). All three were
suppressed by the fix-wave follow-path stale-start guard — each START arrived
in the same batch drain as its matching DONE (windows ~1.5–2 s; the follow
long-poll returns retained messages immediately, so a window that closes
within one read cycle is ALWAYS a matched pair):

```
[17:26:32] skipped 1 stale queue-verify start(s) in the follow batch (matched by completion — no active attempt)
[17:35:56] skipped 1 stale queue-verify start(s) in the follow batch (matched by completion — no active attempt)
[17:48:57] skipped 1 stale queue-verify start(s) in the follow batch (matched by completion — no active attempt)
           flow completed before trigger — exiting cleanly (no kill)
```

This is Fix 1 (follow-path guard) doing exactly what it was merged to do —
zero false kills on completed attempts — with a quantified cost: **under the
new semantics a ~2 s verify window is structurally unkillable via the stream
lane** (a START whose DONE is published within the next read cycle is a
matched pair before any firing decision). The remaining live-fire paths are
the poll fallback phasing into a window (5 s cadence vs ~2 s window ≈ 30 %
per window — missed 3/3 this run) or a cadence at the low end of the
sanctioned 1–5 s range (a 1 s long-poll ends the batch BEFORE the DONE
arrives, making the live start unmatched and fireable mid-attempt).
Per the run bounds: documented, no retry (no cx10). Sidecar
`/tmp/kill-events-cx9.jsonl` was never written (0 firings, exactly-once
held trivially); battery = 20 PASS / 6 FAIL, all six the absent kill arc.

## (e) Demo video — RE-RECORDED during this run

`presentation/assets/demo.webm` — 88 s page capture of the mission-control
dashboard taken live at ~14:22 UTC (cx9b mid-flight: prep-generate retry
chain in the activity feed, flow chip `cx9b: 0/10 files · running`, all
health chips green). Replaces the previous capture.

## Substance (battery 20 PASS)

- COMPLETED with 13 done rows = 10 round-1 units + 3 fix rounds; 5 test
  ports through the same pipeline; keyed commits reachable; 13/13 expected
  outputs present at integration HEAD; bootstrap contract; vitest RAN
  39/4/43 (honest at completion); burn-down + skipped-vs-completed dedup
  (15 skipped envelopes); no duplicate op-IDs; zero re-ports.
- Survived a mid-run dex CONTINUED_AS_NEW rollover (2 parent runs, 227
  envelopes across runs + 13 children visible to the battery).
- AC2: `presentation/assets/report-final.md` — provenance_ok=true
  (77 envelopes on the final run, 16 start markers, 0 interrupted,
  8 verdict records, 0 tombstones, kill events: none recorded — honest).
