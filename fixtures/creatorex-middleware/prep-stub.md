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
| `src/Access/EntitlementChecker.php` | `src/access/entitlement-checker.ts` | feature-flag + plan-tier checks; string-typed tiers → discriminated union |
| `src/Billing/SubscriptionService.php` | `src/billing/subscription-service.ts` | state machine over assoc-array rows → named states |
| `src/Moderation/ChatSentinel.php` | `src/moderation/chat-sentinel.ts` | regex rules + strike counters; PHP `preg_*` semantics |
| `src/Payouts/EarningsLedger.php` | `src/payouts/earnings-ledger.ts` | float money math in cents/major units — decide representation |
| `src/Support/legacy_helpers.php` | `src/support/legacy-helpers.ts` | scalar-coercion helpers; document PHP/TS divergence |
| `tests/*.php` | `test/*.test.ts` | PHPUnit asserts → vitest `expect` |
