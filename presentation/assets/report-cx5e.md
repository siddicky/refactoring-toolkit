# Porting Run Metrics Report

_generated_at: 2026-09-26T20:51:51.196Z_

## Provenance
- status: OK

## Summary
- files: 6 (PORTING.spec.md, src/Access/EntitlementChecker.php, src/Billing/SubscriptionService.php, src/Moderation/ChatSentinel.php, src/Payouts/EarningsLedger.php, src/Support/legacy_helpers.php)
- envelopes: 213 (start markers: 44, interrupted: 0)
- completed verdict records: 22
- tokens (model-calling roles): 2292331
- total wall clock: 6035487 ms

## Findings and agreement

### PORTING.spec.md — round 0 (agreement: agree-clean)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 0 |  |
| reviewer-B | 0 |  |
- agreement: agree-clean — both completed reviews report zero findings

### src/Access/EntitlementChecker.php — round 1 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 1 | major |
| reviewer-B | 1 | major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 1, reviewer-B has 1, matched 0
- citation checks: F1=1.00, F1=1.00

### src/Access/EntitlementChecker.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 1 | minor |
| reviewer-B | 0 |  |
- agreement: disagree — one-sided: only reviewer-A reports findings
- citation checks: F1=1.00

### src/Billing/SubscriptionService.php — round 1 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 4 | major, major, major, major |
| reviewer-B | 3 | major, major, major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 4, reviewer-B has 3, matched 0
- citation checks: F1=1.00, F2=1.00, F3=1.00, F4=1.00, F1=1.00, F2=1.00, F3=1.00

### src/Billing/SubscriptionService.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 2 | minor, major |
| reviewer-B | 3 | major, major, major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 2, reviewer-B has 3, matched 0
- citation checks: F1=1.00, F2=1.00, F1=1.00, F2=1.00, F3=1.00

### src/Moderation/ChatSentinel.php — round 1 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 1 | major |
| reviewer-B | 1 | major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 1, reviewer-B has 1, matched 0
- citation checks: F1=1.00, F1=1.00

### src/Moderation/ChatSentinel.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 1 | major |
| reviewer-B | 1 | major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 1, reviewer-B has 1, matched 0
- citation checks: F1=1.00, F1=1.00

### src/Payouts/EarningsLedger.php — round 1 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 1 | blocker |
| reviewer-B | 2 | blocker, blocker |
- agreement: disagree — findings could not be fully paired: reviewer-A has 1, reviewer-B has 2, matched 1
- citation checks: F1=0.99, F1=0.99, F2=0.99

### src/Payouts/EarningsLedger.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 2 | major, major |
| reviewer-B | 1 | major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 2, reviewer-B has 1, matched 0
- citation checks: F1=1.00, F2=1.00, F1=1.00

### src/Support/legacy_helpers.php — round 1 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 1 | major |
| reviewer-B | 1 | major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 1, reviewer-B has 1, matched 0
- citation checks: F1=1.00, F1=1.00

### src/Support/legacy_helpers.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 4 | major, major, minor, major |
| reviewer-B | 1 | major |
- agreement: disagree — findings could not be fully paired: reviewer-A has 4, reviewer-B has 1, matched 0
- citation checks: F1=1.00, F2=1.00, F3=1.00, F4=1.00, F1=1.00

## Tokens and wall clock per file and role
| file | role | steps | tokens | wall clock ms |
| --- | --- | --- | --- | --- |
| (flow) | agent | 6 | 380701 | 1392787 |
| (flow) | diff-capture | 1 | n/a | 16 |
| (flow) | judgment | 1 | 17525 | 2580 |
| (flow) | queue | 2 | n/a | 516 |
| (flow) | record | 21 | n/a | 379 |
| (flow) | review | 2 | 81985 | 24403 |
| (flow) | verdict-check | 1 | n/a | 1 |
| src/Access/EntitlementChecker.php | agent | 3 | 173023 | 336759 |
| src/Access/EntitlementChecker.php | commit | 2 | n/a | 64 |
| src/Access/EntitlementChecker.php | diff-capture | 2 | n/a | 26 |
| src/Access/EntitlementChecker.php | prioritize | 2 | n/a | 1 |
| src/Access/EntitlementChecker.php | record | 12 | n/a | 31 |
| src/Access/EntitlementChecker.php | review | 4 | 165671 | 51479 |
| src/Access/EntitlementChecker.php | verdict-check | 2 | n/a | 3 |
| src/Billing/SubscriptionService.php | agent | 3 | 217853 | 1207672 |
| src/Billing/SubscriptionService.php | commit | 2 | n/a | 59 |
| src/Billing/SubscriptionService.php | diff-capture | 2 | n/a | 26 |
| src/Billing/SubscriptionService.php | prioritize | 2 | n/a | 0 |
| src/Billing/SubscriptionService.php | record | 12 | n/a | 32 |
| src/Billing/SubscriptionService.php | review | 4 | 172103 | 48076 |
| src/Billing/SubscriptionService.php | verdict-check | 2 | n/a | 1 |
| src/Moderation/ChatSentinel.php | agent | 3 | 197078 | 912336 |
| src/Moderation/ChatSentinel.php | commit | 2 | n/a | 63 |
| src/Moderation/ChatSentinel.php | diff-capture | 2 | n/a | 27 |
| src/Moderation/ChatSentinel.php | prioritize | 2 | n/a | 0 |
| src/Moderation/ChatSentinel.php | record | 12 | n/a | 47 |
| src/Moderation/ChatSentinel.php | review | 4 | 166307 | 61484 |
| src/Moderation/ChatSentinel.php | verdict-check | 2 | n/a | 1 |
| src/Payouts/EarningsLedger.php | agent | 3 | 186645 | 692548 |
| src/Payouts/EarningsLedger.php | commit | 2 | n/a | 70 |
| src/Payouts/EarningsLedger.php | diff-capture | 2 | n/a | 26 |
| src/Payouts/EarningsLedger.php | prioritize | 2 | n/a | 1 |
| src/Payouts/EarningsLedger.php | record | 12 | n/a | 44 |
| src/Payouts/EarningsLedger.php | review | 4 | 165688 | 56003 |
| src/Payouts/EarningsLedger.php | verdict-check | 2 | n/a | 2 |
| src/Support/legacy_helpers.php | agent | 3 | 202382 | 1198792 |
| src/Support/legacy_helpers.php | commit | 2 | n/a | 61 |
| src/Support/legacy_helpers.php | diff-capture | 2 | n/a | 30 |
| src/Support/legacy_helpers.php | prioritize | 2 | n/a | 1 |
| src/Support/legacy_helpers.php | record | 12 | n/a | 25 |
| src/Support/legacy_helpers.php | review | 4 | 165370 | 49015 |
| src/Support/legacy_helpers.php | verdict-check | 2 | n/a | 0 |

## Cost per role (provider-reported split)
| role | calls | input | cache-read | cache-write | reasoning | output | cost USD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agent | 21 | 772484 | 349824 | 0 | 196474 | 38900 | ~$0 |
| judgment | 1 | n/a | n/a | n/a | n/a | n/a | n/a |
| review | 22 | 329308 | 576000 | 0 | 7946 | 3870 | ~$0 |

- total cost: ~$0.0000
- `~` = estimated: tokens flowed on a lane whose provider reports no per-call cost (plan-authed); the USD total is not exact.

## Fixer retries
| file | retries |
| --- | --- |
| src/Access/EntitlementChecker.php | 0 |
| src/Billing/SubscriptionService.php | 0 |
| src/Moderation/ChatSentinel.php | 0 |
| src/Payouts/EarningsLedger.php | 0 |
| src/Support/legacy_helpers.php | 0 |

## Queue burn-down

### tsc
| iteration | total | per file |
| --- | --- | --- |
| 1 | 6 | src/access/entitlement-checker.ts:2, src/billing/subscription-service.ts:1, src/moderation/chat-sentinel.ts:1, src/payouts/earnings-ledger.ts:1, src/support/legacy-helpers.ts:1 |
| 2 | 3 | src/moderation/chat-sentinel.ts:1, src/payouts/earnings-ledger.ts:1, src/support/legacy-helpers.ts:1 |
| 3 | 1 | src/support/legacy-helpers.ts:1 |
| 4 | 0 | (total):0 |

### vitest
| iteration | total | per file |
| --- | --- | --- |
| 1 | 0 | (total):0 |
| 2 | 0 | (total):0 |
| 3 | 0 | (total):0 |
| 4 | 0 | (total):0 |

## Kill events
- kill-intent run=cx5-kill-1 utc=2026-09-26T19:50:38.665Z monotonic_ms=45 target_pids=68294,72852
- kill-completed run=cx5-kill-1 utc=2026-09-26T19:50:38.719Z monotonic_ms=98 resumed=false note=all targets exited after SIGKILL (reason=cx-5 fix-round kill smoke: queue-verify reached (wave-5 AC1))

- interrupted envelopes: 0

## Dispatch anchoring (dex typed 1:N)
- status: OK
- envelopes anchored: 213
- dispatch entries: 368 (non-agent kinds: 0, unexplained: 0)
- model steps missing start marker: 0
