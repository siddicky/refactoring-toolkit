# PORTING PREP — `CreatorEx` PHP → TypeScript

> **STATUS: STUB — DEMO BASELINE ARTIFACT.**
> Hand-written stand-in consumed by the porting loop as the artifact-diff
> baseline. The flow's prep-analysis phase (implementer-generated spec map +
> per-symbol table, adversarially reviewed) replaces it before any file is
> ported. Do not treat these contents as reviewed.

Module root: `fixtures/creatorex-middleware/` — namespace `CreatorEx`
(PSR-4: `src/`), tests in `tests/` (PHPUnit style; the port targets vitest).
The PHP side is read-only input; no PHP toolchain runs anywhere in the
pipeline.

## 1. Source map

| PHP file | Proposed port target | Notes |
|---|---|---|
| `src/Access/EntitlementChecker.php` | `src/access/entitlement-checker.ts` | entitlement + age + geo gates composed through `__call` fluent `require*`; non-strict `in_array` and `??` traps |
| `src/Billing/SubscriptionService.php` | `src/billing/subscription-service.ts` | state machine over assoc-array rows → named states |
| `src/Moderation/ChatSentinel.php` | `src/moderation/chat-sentinel.ts` | substring (`stripos`) blocklist + `preg_replace` PII redaction; PHP `preg_*` semantics |
| `src/Payouts/EarningsLedger.php` | `src/payouts/earnings-ledger.ts` | float money math in cents/major units — decide representation |
| `src/Support/legacy_helpers.php` | `src/support/legacy-helpers.ts` | scalar-coercion helpers; document PHP/TS divergence |
| `tests/Access/EntitlementCheckerTest.php` | `test/access/entitlement-checker.test.ts` | US-010 TEST PORT: PHPUnit asserts → vitest `expect` (scope: ported output) |
| `tests/Billing/SubscriptionServiceTest.php` | `test/billing/subscription-service.test.ts` | US-010 TEST PORT: state-machine coverage → vitest suites |
| `tests/Moderation/ChatSentinelTest.php` | `test/moderation/chat-sentinel.test.ts` | US-010 TEST PORT: regex-rule cases → vitest suites |
| `tests/Payouts/EarningsLedgerTest.php` | `test/payouts/earnings-ledger.test.ts` | US-010 TEST PORT: money-math cases → vitest suites |
| `tests/Support/LegacyHelpersTest.php` | `test/support/legacy-helpers.test.ts` | US-010 TEST PORT: coercion cases → vitest suites |

> The `tests/*.php` glob convention ( PHPUnit asserts → vitest `expect` ) is
> materialized above as one explicit row per test file — exact rows are what
> the port loop's seed lookup consumes (glob rows are documentation only).
