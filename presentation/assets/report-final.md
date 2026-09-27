# Porting Run Metrics Report

_generated_at: 2026-09-27T17:53:11.457Z_

## Provenance
- status: OK

## Summary
- files: 4 (PORTING.spec.md, src/Support/legacy_helpers.php, tests/Access/EntitlementCheckerTest.php, tests/Billing/SubscriptionServiceTest.php)
- envelopes: 77 (start markers: 16, interrupted: 0)
- completed verdict records: 8
- tombstoned reviewers: 0
- tokens (model-calling roles): 1195745
- total wall clock: 5051450 ms

## Findings and agreement

### PORTING.spec.md — round 0 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 6 | major, minor, minor, minor, minor, nit |
| reviewer-B | 7 | major, minor, minor, minor, minor, minor, nit |
- agreement: disagree — findings could not be fully paired: reviewer-A has 6, reviewer-B has 7, matched 2
- citation checks: F1=1.00, F2=1.00, F3=1.00, F4=1.00, F5=1.00, F6=1.00, F1=0.99, F2=0.98, F3=0.99, F4=0.98, F5=0.98, F6=0.98, F7=0.97

### src/Support/legacy_helpers.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 3 | minor, minor, nit |
| reviewer-B | 2 | minor, nit |
- agreement: disagree — findings could not be fully paired: reviewer-A has 3, reviewer-B has 2, matched 1
- citation checks: F1=1.00, F2=1.00, F3=1.00, F1=1.00, F2=0.99

### tests/Access/EntitlementCheckerTest.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 2 | nit, nit |
| reviewer-B | 1 | minor |
- agreement: disagree — findings could not be fully paired: reviewer-A has 2, reviewer-B has 1, matched 0
- citation checks: F1=0.99, F2=0.99, F1=1.00

### tests/Billing/SubscriptionServiceTest.php — round 2 (agreement: disagree)
| reviewer | findings | severities |
| --- | --- | --- |
| reviewer-A | 2 | minor, minor |
| reviewer-B | 1 | minor |
- agreement: disagree — findings could not be fully paired: reviewer-A has 2, reviewer-B has 1, matched 1
- citation checks: F1=1.00, F2=1.00, F1=0.99

## Tokens and wall clock per file and role
| file | role | steps | tokens | wall clock ms |
| --- | --- | --- | --- | --- |
| (flow) | agent | 2 | 165985 | 1000721 |
| (flow) | diff-capture | 1 | n/a | 11 |
| (flow) | integration | 1 | n/a | 2 |
| (flow) | judgment | 1 | 76839 | 11893 |
| (flow) | queue | 1 | n/a | 1258 |
| (flow) | record | 14 | n/a | 91 |
| (flow) | review | 4 | 348705 | 2446629 |
| (flow) | verdict-check | 1 | n/a | 1 |
| src/Support/legacy_helpers.php | agent | 1 | 56436 | 88636 |
| src/Support/legacy_helpers.php | commit | 1 | n/a | 54 |
| src/Support/legacy_helpers.php | diff-capture | 1 | n/a | 15 |
| src/Support/legacy_helpers.php | record | 6 | n/a | 45 |
| src/Support/legacy_helpers.php | review | 2 | 125580 | 470722 |
| src/Support/legacy_helpers.php | verdict-check | 1 | n/a | 219 |
| tests/Access/EntitlementCheckerTest.php | agent | 1 | 54735 | 51813 |
| tests/Access/EntitlementCheckerTest.php | commit | 1 | n/a | 48 |
| tests/Access/EntitlementCheckerTest.php | diff-capture | 1 | n/a | 17 |
| tests/Access/EntitlementCheckerTest.php | record | 6 | n/a | 50 |
| tests/Access/EntitlementCheckerTest.php | review | 2 | 111963 | 197639 |
| tests/Access/EntitlementCheckerTest.php | verdict-check | 1 | n/a | 221 |
| tests/Billing/SubscriptionServiceTest.php | agent | 1 | 61681 | 255394 |
| tests/Billing/SubscriptionServiceTest.php | commit | 1 | n/a | 52 |
| tests/Billing/SubscriptionServiceTest.php | diff-capture | 1 | n/a | 17 |
| tests/Billing/SubscriptionServiceTest.php | record | 6 | n/a | 48 |
| tests/Billing/SubscriptionServiceTest.php | review | 2 | 193821 | 525623 |
| tests/Billing/SubscriptionServiceTest.php | verdict-check | 1 | n/a | 231 |

## Cost per role (provider-reported split)
| role | calls | input | cache-read | cache-write | reasoning | output | cost USD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agent | 5 | 243935 | 33920 | 0 | 42656 | 18326 | ~$0 |
| judgment | 1 | n/a | n/a | n/a | n/a | n/a | n/a |
| review | 10 | 611030 | 576 | 0 | 164790 | 3673 | ~$0 |

- total cost: ~$0.0000
- `~` = estimated: tokens flowed on a lane whose provider reports no per-call cost (plan-authed); the USD total is not exact.

## Fixer retries
_no fixer steps in the stream_

## Queue burn-down

### tsc
| iteration | total | per file |
| --- | --- | --- |
| 1 | 5 | src/support/legacy-helpers.ts:2, test/access/entitlement-checker.test.ts:1, test/billing/subscription-service.test.ts:2 |
| 2 | 2 | test/billing/subscription-service.test.ts:2 |
| 3 | 0 | (total):0 |

### vitest
| iteration | total | per file |
| --- | --- | --- |
| 1 | 4 failed (39 passed / 43 total) | (total):4 |
| 2 | 4 failed (39 passed / 43 total) | (total):4 |
| 3 | 4 failed (39 passed / 43 total) | (total):4 |

## Verification
- typecheck (tsc): PASS at final iteration (0 remaining errors)
- tests (vitest): RAN — 39 passed / 4 failed of 43 total (test-verified only when failed = 0)

## Kill events
_none recorded_

- interrupted envelopes: 0

## Dispatch anchoring (dex typed 1:N)
- status: OK
- envelopes anchored: 77
- dispatch entries: 174 (non-agent kinds: 0, unexplained: 0)
- model steps missing start marker: 0
