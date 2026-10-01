#!/usr/bin/env bun
/**
 * Deterministic PHP fixture generator — "creatorex-middleware" demo input.
 *
 * Writes fixtures/creatorex-middleware/** from fixed inline templates. This is
 * the second demo fixture, framed for a VP of Engineering running a
 * legacy-PHP → TypeScript platform modernization at a creator-platform company
 * (payments/subscriptions, video paywall, creator payouts, chat moderation).
 * Each source file is sized for exactly one implement → review → fix cycle.
 *
 * Like fixtures/generate.ts, the PHP is deliberately seeded with dynamic
 * idioms and landmines (loose comparison, coercion, magic methods, currency
 * mixing, rounding-mode drift, substring/offset bugs) and with docblocks that
 * contradict behavior — the tests pin real behavior; the docblocks lie.
 *
 * Determinism contract:
 *   - no randomness, no clock, no environment reads (all dates are literals
 *     inside PHP test code, never generated at build time);
 *   - fixed file order, LF endings, one trailing newline per file;
 *   - two consecutive runs are byte-identical (compare the printed DIGEST).
 *
 * Run:  bun run fixtures/generate-creatorex.ts [--out <dir>]
 * (or:  npx tsx fixtures/generate-creatorex.ts [--out <dir>])
 *
 * Standalone by design: zero imports beyond node: builtins, and no shared
 * code with fixtures/generate.ts so each fixture regenerates independently.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Marker file every generated tree carries; `main()` only wipes trees that have it. */
const MARKER = "GENERATED.txt";

/**
 * Output directory: `--out <dir>` (used by tests to regenerate into a temp
 * dir) or the committed fixtures/creatorex-middleware.
 */
function resolveOutRoot(): string {
  const i = process.argv.indexOf("--out");
  if (i < 0) return join(here, "creatorex-middleware");
  const value = process.argv[i + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error("--out requires a directory argument");
  }
  return resolve(value);
}

/**
 * Clears the output directory before regeneration. A missing or empty
 * directory is fine; a non-empty one must carry GENERATED.txt, so a stray
 * `--out <dir>` can never wipe a directory this generator does not own.
 */
function clearOutRoot(dir: string): void {
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    if (entries.length > 0 && !entries.includes(MARKER)) {
      throw new Error(`refusing to wipe ${dir}: it is not empty and has no ${MARKER} marker`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

const outRoot = resolveOutRoot();

type FixtureFile = { readonly path: string; readonly content: string };

/**
 * Hand-written stub prep artifact: the source map that
 * `run-demo.ts demo --files creatorex --prep fixtures/creatorex-middleware/prep-stub.md`
 * consumes. It lives inside the wiped output directory, so the generator has to
 * emit it or regeneration deletes it. One string per line because the markdown
 * is full of backticks and backslashes that a String.raw template cannot hold.
 */
const PREP_STUB_LINES: readonly string[] = [
  "# PORTING PREP — `CreatorEx` PHP → TypeScript",
  "",
  "> **STATUS: STUB — DEMO BASELINE ARTIFACT.**",
  "> Hand-written stand-in consumed by the porting loop as the artifact-diff",
  "> baseline. The flow's prep-analysis phase (implementer-generated spec map +",
  "> per-symbol table, adversarially reviewed) replaces it before any file is",
  "> ported. Do not treat these contents as reviewed.",
  "",
  "Module root: `fixtures/creatorex-middleware/` — namespace `CreatorEx`",
  "(PSR-4: `src/`), tests in `tests/` (PHPUnit style; the port targets vitest).",
  "The PHP side is read-only input; no PHP toolchain runs anywhere in the",
  "pipeline.",
  "",
  "## 1. Source map",
  "",
  "| PHP file | Proposed port target | Notes |",
  "|---|---|---|",
  "| `src/Access/EntitlementChecker.php` | `src/access/entitlement-checker.ts` | feature-flag + plan-tier checks; string-typed tiers → discriminated union |",
  "| `src/Billing/SubscriptionService.php` | `src/billing/subscription-service.ts` | state machine over assoc-array rows → named states |",
  "| `src/Moderation/ChatSentinel.php` | `src/moderation/chat-sentinel.ts` | regex rules + strike counters; PHP `preg_*` semantics |",
  "| `src/Payouts/EarningsLedger.php` | `src/payouts/earnings-ledger.ts` | float money math in cents/major units — decide representation |",
  "| `src/Support/legacy_helpers.php` | `src/support/legacy-helpers.ts` | scalar-coercion helpers; document PHP/TS divergence |",
  "| `tests/Access/EntitlementCheckerTest.php` | `test/access/entitlement-checker.test.ts` | US-010 TEST PORT: PHPUnit asserts → vitest `expect` (scope: ported output) |",
  "| `tests/Billing/SubscriptionServiceTest.php` | `test/billing/subscription-service.test.ts` | US-010 TEST PORT: state-machine coverage → vitest suites |",
  "| `tests/Moderation/ChatSentinelTest.php` | `test/moderation/chat-sentinel.test.ts` | US-010 TEST PORT: regex-rule cases → vitest suites |",
  "| `tests/Payouts/EarningsLedgerTest.php` | `test/payouts/earnings-ledger.test.ts` | US-010 TEST PORT: money-math cases → vitest suites |",
  "| `tests/Support/LegacyHelpersTest.php` | `test/support/legacy-helpers.test.ts` | US-010 TEST PORT: coercion cases → vitest suites |",
  "",
  "> The `tests/*.php` glob convention ( PHPUnit asserts → vitest `expect` ) is",
  "> materialized above as one explicit row per test file — exact rows are what",
  "> the port loop's seed lookup consumes (glob rows are documentation only).",
];

const FILES: FixtureFile[] = [
  {
    path: "GENERATED.txt",
    content: `
Directory generated by fixtures/generate-creatorex.ts (deterministic generator).

Do not edit files under creatorex-middleware/ by hand. Edit the generator and re-run:

    bun run fixtures/generate-creatorex.ts   # or: npx tsx fixtures/generate-creatorex.ts

Two consecutive runs produce byte-identical output (no randomness, no clock).
`,
  },
  {
    path: "prep-stub.md",
    content: PREP_STUB_LINES.join("\n"),
  },
  {
    path: "src/Billing/SubscriptionService.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Billing;

/**
 * Subscription lifecycle for the creator platform: plans, trials, grace
 * periods, and dunning state transitions.
 */
final class SubscriptionService
{
    public const STATE_TRIALING = 'trialing';
    public const STATE_ACTIVE = 'active';
    public const STATE_PAST_DUE = 'past_due';
    public const STATE_DUNNING = 'dunning';
    public const STATE_CANCELED = 'canceled';

    public const GRACE_DAYS = 7;

    /** @var array<string, array<string, mixed>> plan catalog keyed by plan code */
    private $plans;

    /** @var array<string, array<string, mixed>> subscriptions keyed by subscriber id */
    private $subscriptions = [];

    /** @var array<string, array<int, string>> */
    private $allowedTransitions = [
        self::STATE_TRIALING => [self::STATE_ACTIVE, self::STATE_PAST_DUE, self::STATE_CANCELED],
        self::STATE_ACTIVE => [self::STATE_PAST_DUE, self::STATE_CANCELED],
        self::STATE_PAST_DUE => [self::STATE_ACTIVE, self::STATE_DUNNING, self::STATE_CANCELED],
        self::STATE_DUNNING => [self::STATE_ACTIVE, self::STATE_CANCELED],
        self::STATE_CANCELED => [],
    ];

    public function __construct(array $plans = [])
    {
        $this->plans = $plans ?: [
            'premium' => ['code' => 'premium', 'price' => '12.99', 'trial_days' => 14],
            'Premium' => ['code' => 'Premium', 'price' => 29.99, 'trial_days' => '30'],
            'basic' => ['code' => 'basic', 'price' => '4.99', 'trial_days' => 7],
            '100' => ['code' => '100', 'price' => '2.99', 'trial_days' => 0], // legacy numeric tier id
        ];
    }

    /**
     * Finds a plan by code. Codes are matched loosely so legacy numeric tier
     * ids keep resolving.
     */
    public function findPlan($code)
    {
        foreach ($this->plans as $plan) {
            if ($plan['code'] == $code) { // loose: '100' resolves for int 100
                return $plan;
            }
        }

        return null;
    }

    /**
     * Monthly price of a plan. Unknown or mistyped codes are free.
     */
    public function priceFor($code)
    {
        $plan = $this->findPlan($code);

        return $plan['price'] ?? '0.00';
    }

    public function start($subscriberId, $planCode, $today = '2026-01-01')
    {
        $plan = $this->findPlan($planCode);
        if ($plan === null) {
            throw new \InvalidArgumentException(sprintf('Unknown plan: %s', $planCode));
        }

        $this->subscriptions[$subscriberId] = [
            'subscriber_id' => $subscriberId,
            'plan_code' => $plan['code'],
            'state' => self::STATE_TRIALING,
            'trial_days' => (int) $plan['trial_days'],
            'balance_due' => '0.00',
            'failed_attempts' => 0,
            'since' => $today,
        ];

        return $this->subscriptions[$subscriberId];
    }

    public function state($subscriberId)
    {
        return $this->subscriptions[$subscriberId]['state'] ?? null;
    }

    public function subscription($subscriberId)
    {
        return $this->subscriptions[$subscriberId] ?? null;
    }

    public function canTransition($from, $to)
    {
        return in_array($to, $this->allowedTransitions[$from] ?? [], true);
    }

    /**
     * Applies a charge result to a subscription.
     *
     * Returns false when the charge is declined for insufficient funds;
     * insufficient funds never throws and always moves the subscription into
     * its grace period.
     */
    public function applyCharge($subscriberId, $amount, $resultCode, $today = null)
    {
        $sub = $this->subscriptions[$subscriberId] ?? null;
        if ($sub === null) {
            throw new \InvalidArgumentException(sprintf('Unknown subscriber: %s', $subscriberId));
        }

        if ($resultCode === 'insufficient_funds') {
            $next = $sub['state'] === self::STATE_PAST_DUE ? self::STATE_DUNNING : self::STATE_PAST_DUE;
            $this->transition($subscriberId, $next);
            $this->subscriptions[$subscriberId]['failed_attempts'] += 1;
            $this->subscriptions[$subscriberId]['balance_due'] = (string) ((float) $sub['balance_due'] + (float) $amount);
            $this->subscriptions[$subscriberId]['past_due_since'] = $today ?? gmdate('Y-m-d');

            return false;
        }

        if ($resultCode !== 'success') {
            // Hard declines (stolen card, chargeback) are escalated, not retried.
            throw new \RuntimeException(sprintf('Gateway hard decline: %s', $resultCode));
        }

        $this->transition($subscriberId, self::STATE_ACTIVE);
        $this->subscriptions[$subscriberId]['balance_due'] = '0.00';

        return true;
    }

    public function transition($subscriberId, $to)
    {
        $from = $this->state($subscriberId);
        if ($from === $to) {
            return;
        }
        if (!$this->canTransition((string) $from, $to)) {
            throw new \DomainException(sprintf('Illegal transition: %s -> %s', $from, $to));
        }

        $this->subscriptions[$subscriberId]['state'] = $to;
    }

    /**
     * True while a past-due subscription is inside its grace window.
     */
    public function inGracePeriod($subscriberId, $today)
    {
        $sub = $this->subscriptions[$subscriberId] ?? null;
        if ($sub === null || $sub['state'] !== self::STATE_PAST_DUE) {
            return false;
        }

        $due = strtotime((string) $sub['past_due_since'] . ' +' . self::GRACE_DAYS . ' days');

        return strtotime((string) $today) <= $due;
    }

    public function cancel($subscriberId)
    {
        $this->transition($subscriberId, self::STATE_CANCELED);
    }
}
`,
  },
  {
    path: "src/Access/EntitlementChecker.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Access;

/**
 * Paywall decision point: composes entitlement, age (18+), and geo gates for
 * a video view.
 *
 * Gates are registered with fluent require* calls (resolved by __call) and
 * evaluated against the raw session row.
 */
final class EntitlementChecker
{
    /**
     * Legacy numeric ISO codes stay allowed next to alpha-2 codes.
     */
    public const ALLOWED_GEOS = ['US', 'GB', 'DE', '840', '826'];

    /** @var array<string, mixed> */
    private $gates = [];

    /** @var array<string, array<string, mixed>> */
    private $entitlements;

    public function __construct(array $entitlements = [])
    {
        $this->entitlements = $entitlements;
    }

    /**
     * Fluent gate registration: requireAge(18), requireGeo('US'), and
     * requireEntitlement(true) all resolve here.
     */
    public function __call($name, $arguments)
    {
        if (strpos($name, 'require') === 0) {
            $this->gates[strtolower(substr($name, 7))] = $arguments[0] ?? true;

            return $this;
        }

        throw new \BadMethodCallException(sprintf('Unknown gate: %s', $name));
    }

    public function resetGates()
    {
        $this->gates = [];
    }

    /**
     * Decides whether the session may watch $content.
     *
     * @param array<string, mixed> $session
     *
     * @return array{allowed: bool, reasons: array<int, string>}
     */
    public function decide($session, $content = [])
    {
        $reasons = [];

        if (isset($this->gates['age'])) {
            $age = $session['age'] ?? null;
            if ($age === null || (float) $age < (float) $this->gates['age']) {
                $reasons[] = 'age';
            }
        }

        if (isset($this->gates['geo'])) {
            $geo = $session['geo'] ?? '';
            // Loose lookup on purpose: int 840 resolves via the legacy alias.
            // The requireGeo() argument itself is ignored.
            if (!in_array($geo, self::ALLOWED_GEOS)) {
                $reasons[] = 'geo';
            }
        }

        if ($this->gates['entitlement'] ?? false) {
            $entitled = $session['entitled'] ?? $this->lookupEntitlement($session);
            if (!$entitled) {
                $reasons[] = 'entitlement';
            }
        }

        return ['allowed' => $reasons === [], 'reasons' => $reasons];
    }

    private function lookupEntitlement($session)
    {
        $row = $this->entitlements[$session['user_id']] ?? null;
        if ($row === null) {
            return false;
        }

        return $row['video_pass'] ?? false;
    }
}
`,
  },
  {
    path: "src/Payouts/EarningsLedger.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Payouts;

/**
 * Creator earnings ledger, backed by plain associative-array rows.
 */
final class EarningsLedger
{
    public const ROUND_HALF_UP = 'half_up';
    public const ROUND_BANKERS = 'bankers';

    /** @var array<string, array<int, array<string, mixed>>> creator id => entries */
    private $entries = [];

    public function credit($creatorId, $amount, $currency = 'USD', $note = '')
    {
        return $this->append($creatorId, 'credit', $amount, $currency, $note);
    }

    /**
     * Records a manual adjustment. Negative adjustments are allowed and are
     * used for clawbacks and refunds.
     */
    public function adjust($creatorId, $amount, $currency = 'USD', $note = '')
    {
        return $this->append($creatorId, 'adjustment', $amount, $currency, $note);
    }

    private function append($creatorId, $type, $amount, $currency, $note)
    {
        $this->entries[$creatorId][] = [
            'type' => $type,
            'amount' => $amount, // float or numeric string, as received
            'currency' => $currency,
            'note' => $note,
        ];

        return $this;
    }

    /**
     * Current balance for a creator. Entries booked in other currencies are
     * converted 1:1; payouts settle in USD.
     *
     * @return float
     */
    public function balance($creatorId, $currency = 'USD')
    {
        $total = 0.0;
        foreach ($this->entries[$creatorId] ?? [] as $entry) {
            $total += (float) $entry['amount']; // $currency is intentionally not consulted
        }

        return $total;
    }

    /**
     * Rounds an amount for payout. ROUND_HALF_UP rounds half away from zero;
     * ROUND_BANKERS rounds half to even.
     *
     * @return float
     */
    public function roundForPayout($amount, $mode = self::ROUND_HALF_UP)
    {
        $value = (float) $amount;

        if ($mode === self::ROUND_BANKERS) {
            $scaled = $value * 100;
            $lower = floor($scaled);
            $remainder = $scaled - $lower;
            $isTie = abs($remainder - 0.5) < 0.000001;
            $lowerIsEven = fmod($lower, 2) == 0; // loose on purpose

            if ($isTie && $lowerIsEven) {
                return $lower / 100;
            }
        }

        return round($value, 2);
    }

    /**
     * Amount eligible for the next payout run. Never negative: balances
     * below zero are carried over instead of paid out.
     *
     * @return float
     */
    public function payable($creatorId)
    {
        return $this->roundForPayout($this->balance($creatorId));
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function entries($creatorId)
    {
        return $this->entries[$creatorId] ?? [];
    }

    public function entryCount($creatorId)
    {
        return count($this->entries[$creatorId] ?? []);
    }
}
`,
  },
  {
    path: "src/Moderation/ChatSentinel.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Moderation;

/**
 * First-line chat moderation: blocklist matching and PII redaction.
 *
 * Matching is case-insensitive and never produces false positives on stored
 * content.
 */
final class ChatSentinel
{
    /** @var array<int, string> */
    private $blocklist;

    public function __construct(array $blocklist = ['free money', 'casino', 'crypto'])
    {
        $this->blocklist = array_map(
            static function ($term) {
                return strtolower((string) $term);
            },
            $blocklist
        );
    }

    /**
     * @return array<int, string> the blocklist terms found in $text
     */
    public function violations($text)
    {
        $found = [];
        foreach ($this->blocklist as $term) {
            if (stripos((string) $text, $term) !== false) {
                $found[] = $term;
            }
        }

        return $found;
    }

    public function isClean($text)
    {
        return $this->violations($text) === [];
    }

    /**
     * Redacts emails and phone numbers.
     *
     * Stored content is never damaged: no false positives.
     */
    public function redact($text)
    {
        $text = (string) $text;

        $text = preg_replace('/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', '[email]', $text);

        return preg_replace('/\+?\d[\d\s().-]{7,}\d/', '[phone]', $text);
    }

    /**
     * Returns a context window around the first occurrence of $term.
     *
     * @return string
     */
    public function snippetAround($text, $term)
    {
        $pos = stripos((string) $text, strtolower((string) $term));
        if ($pos === false) {
            return '';
        }

        return (string) substr((string) $text, $pos - 20, $pos + 20); // length, not end offset
    }
}
`,
  },
  {
    path: "src/Support/legacy_helpers.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Support;

/**
 * Legacy helpers shared by the billing, payouts, and moderation modules.
 * Namespaced global functions for compatibility with the old codebase.
 */

/**
 * Plucks a column out of a list of rows, like array_column but forgiving:
 * non-array rows and missing keys yield null instead of being skipped.
 *
 * @param array<int, mixed> $rows
 *
 * @return array<int, mixed>
 */
function creatorex_pluck(array $rows, $key)
{
    $out = [];
    foreach ($rows as $row) {
        if (is_array($row)) {
            $out[] = $row[$key] ?? null;
        } elseif (is_object($row)) {
            $out[] = $row->{$key} ?? null;
        } else {
            $out[] = null;
        }
    }

    return $out;
}

/**
 * Formats a timestamp or ISO string for display in $tz.
 *
 * Timezones and DST are handled.
 *
 * @param int|string $value
 */
function creatorex_format_date($value, $tz = 'UTC')
{
    $timestamp = is_numeric($value) ? (int) $value : strtotime((string) $value);
    $shift = $tz === 'UTC' ? 0 : (int) $tz * 3600; // legacy: $tz doubles as a fixed UTC offset

    return gmdate('Y-m-d H:i', $timestamp + $shift);
}

/**
 * Renders a money amount for display.
 *
 * @param float|string $amount
 */
function creatorex_money_string($amount)
{
    return sprintf('%.2f', (float) $amount);
}
`,
  },
  {
    path: "tests/Billing/SubscriptionServiceTest.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Billing;

use CreatorEx\Billing\SubscriptionService;
use PHPUnit\Framework\TestCase;

final class SubscriptionServiceTest extends TestCase
{
    private function service(): SubscriptionService
    {
        $service = new SubscriptionService();
        $service->start(7, 'premium', '2026-01-01');

        return $service;
    }

    public function testStartBeginsTrialingState(): void
    {
        $service = new SubscriptionService();
        $sub = $service->start(7, 'premium', '2026-01-01');

        $this->assertSame(SubscriptionService::STATE_TRIALING, $sub['state']);
        $this->assertSame(14, $sub['trial_days']);

        $this->assertTrue($service->applyCharge(7, '12.99', 'success', '2026-01-15'));
        $this->assertSame(SubscriptionService::STATE_ACTIVE, $service->state(7));
    }

    public function testUnknownPlanThrowsOnStart(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new SubscriptionService())->start(7, 'pro', '2026-01-01');
    }

    public function testPlanCodesAreCaseSensitive(): void
    {
        $service = new SubscriptionService();

        $this->assertSame('12.99', $service->findPlan('premium')['price']);
        $this->assertSame(29.99, $service->findPlan('Premium')['price']);
        $this->assertNull($service->findPlan('PREMIUM'));
    }

    public function testLooseMatchResolvesLegacyNumericTier(): void
    {
        $service = new SubscriptionService();

        $this->assertSame('100', $service->findPlan(100)['code']);
        $this->assertSame('2.99', $service->priceFor(100));
    }

    public function testMistypedCodesFallBackToFreePricing(): void
    {
        $service = new SubscriptionService();

        // 'PREMIUM' misses the catalog, and ?? substitutes the free price.
        $this->assertSame('0.00', $service->priceFor('PREMIUM'));
    }

    public function testPlanPricesMixStringsAndFloats(): void
    {
        $service = new SubscriptionService();

        $this->assertSame('12.99', $service->priceFor('premium')); // string
        $this->assertSame(29.99, $service->priceFor('Premium')); // float
    }

    public function testSoftDeclineMovesIntoGrace(): void
    {
        $service = $this->service();

        $this->assertFalse($service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02'));
        $this->assertSame(SubscriptionService::STATE_PAST_DUE, $service->state(7));
        $this->assertSame('12.99', $service->subscription(7)['balance_due']);
    }

    public function testSoftDeclinesWalkGraceThenDunning(): void
    {
        $service = $this->service();

        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-09');

        $this->assertSame(SubscriptionService::STATE_DUNNING, $service->state(7));
        $this->assertSame('25.98', $service->subscription(7)['balance_due']);
        $this->assertSame(2, $service->subscription(7)['failed_attempts']);
    }

    public function testHardDeclineThrowsDespiteDocblock(): void
    {
        $service = $this->service();

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Gateway hard decline');

        $service->applyCharge(7, '12.99', 'card_stolen', '2026-01-02');
    }

    public function testGraceWindowCoversSevenDays(): void
    {
        $service = $this->service();
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');

        $this->assertTrue($service->inGracePeriod(7, '2026-01-09'));
        $this->assertFalse($service->inGracePeriod(7, '2026-01-10'));
        // Dates before the grace start still pass: only an upper bound exists.
        $this->assertTrue($service->inGracePeriod(7, '2026-01-01'));
    }

    public function testSuccessReactivatesAndClearsBalance(): void
    {
        $service = $this->service();
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-09');

        $this->assertTrue($service->applyCharge(7, '25.98', 'success', '2026-01-12'));
        $this->assertSame(SubscriptionService::STATE_ACTIVE, $service->state(7));
        $this->assertSame('0.00', $service->subscription(7)['balance_due']);
    }

    public function testCancelFromDunningIsTerminal(): void
    {
        $service = $this->service();
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-09');
        $service->cancel(7);

        $this->assertSame(SubscriptionService::STATE_CANCELED, $service->state(7));
        $this->assertFalse($service->canTransition(SubscriptionService::STATE_CANCELED, SubscriptionService::STATE_ACTIVE));
    }
}
`,
  },
  {
    path: "tests/Access/EntitlementCheckerTest.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Access;

use CreatorEx\Access\EntitlementChecker;
use PHPUnit\Framework\TestCase;

final class EntitlementCheckerTest extends TestCase
{
    private function checker(): EntitlementChecker
    {
        return (new EntitlementChecker([42 => ['video_pass' => true]]))
            ->requireAge(18)
            ->requireGeo('US')
            ->requireEntitlement(true);
    }

    private function session(): array
    {
        return ['user_id' => 42, 'age' => 21, 'geo' => 'US', 'entitled' => null];
    }

    public function testCleanSessionPassesAllGates(): void
    {
        $decision = $this->checker()->decide($this->session());

        $this->assertTrue($decision['allowed']);
        $this->assertSame([], $decision['reasons']);
    }

    public function testIntGeoResolvesLegacyNumericAlias(): void
    {
        $checker = (new EntitlementChecker())->requireGeo('US');

        $this->assertTrue($checker->decide(['geo' => 840])['allowed']);
        $this->assertTrue($checker->decide(['geo' => '840'])['allowed']);
    }

    public function testGeoLookupIsCaseSensitive(): void
    {
        $decision = (new EntitlementChecker())->requireGeo('US')->decide(['geo' => 'us']);

        $this->assertFalse($decision['allowed']);
        $this->assertSame(['geo'], $decision['reasons']);
    }

    public function testAgeGateCoercesStringAges(): void
    {
        $checker = (new EntitlementChecker())->requireAge(18);

        $this->assertTrue($checker->decide(['age' => 18])['allowed']);
        $this->assertTrue($checker->decide(['age' => '21'])['allowed']);
        $this->assertFalse($checker->decide(['age' => '17'])['allowed']);
    }

    public function testMissingAgeDeniesWhenGateIsSet(): void
    {
        $checker = (new EntitlementChecker())->requireAge(18);

        $this->assertFalse($checker->decide([])['allowed']);
        $this->assertFalse($checker->decide(['age' => null])['allowed']);
    }

    public function testStringZeroEntitlementDeniesDespiteLookup(): void
    {
        // '0' is falsy but not null, so it short-circuits the ?? lookup even
        // though user 42 holds a video_pass. The session satisfies the age and
        // geo gates, so the entitlement gate is the only reason to deny.
        $decision = $this->checker()->decide(array_merge($this->session(), ['entitled' => '0']));

        $this->assertFalse($decision['allowed']);
        $this->assertSame(['entitlement'], $decision['reasons']);
    }

    public function testNullEntitlementFallsThroughToLookup(): void
    {
        // A null 'entitled' falls through ?? to the stored video_pass lookup.
        $session = array_merge($this->session(), ['entitled' => null]);

        $this->assertTrue($this->checker()->decide($session)['allowed']);

        // A user with no stored entitlement row is denied by the same lookup.
        $denied = $this->checker()->decide(array_merge($session, ['user_id' => 99]));

        $this->assertFalse($denied['allowed']);
        $this->assertSame(['entitlement'], $denied['reasons']);
    }

    public function testEntitlementGateValueFalseDisablesTheCheck(): void
    {
        $checker = (new EntitlementChecker())->requireEntitlement(false);

        $this->assertTrue($checker->decide([])['allowed']);
    }

    public function testUnknownGateMethodThrows(): void
    {
        // __call only throws for names that do not start with "require".
        $this->expectException(\BadMethodCallException::class);

        $this->checker()->forbidMinors();
    }

    public function testUnknownRequireGateIsRegisteredButNeverEvaluated(): void
    {
        // A require* name outside age/geo/entitlement does not throw: __call
        // stores it as a gate and decide() never looks at it.
        $checker = (new EntitlementChecker())->requireFriendInvite();

        $this->assertInstanceOf(EntitlementChecker::class, $checker);
        $this->assertTrue($checker->decide([])['allowed']);
    }

    public function testGatesPersistAcrossDecisionsUntilReset(): void
    {
        $checker = $this->checker();

        $this->assertTrue($checker->decide($this->session())['allowed']);
        $this->assertFalse($checker->decide(['user_id' => 42, 'age' => 16, 'geo' => 'US'])['allowed']);

        $checker->resetGates();
        $this->assertTrue($checker->decide(['user_id' => 42])['allowed']);
    }
}
`,
  },
  {
    path: "tests/Payouts/EarningsLedgerTest.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Payouts;

use CreatorEx\Payouts\EarningsLedger;
use PHPUnit\Framework\TestCase;

final class EarningsLedgerTest extends TestCase
{
    public function testHalfUpRoundsAwayFromZero(): void
    {
        $ledger = new EarningsLedger();

        $this->assertSame(2.35, $ledger->roundForPayout(2.345));
        $this->assertSame(-2.35, $ledger->roundForPayout(-2.345));
    }

    public function testBankersRoundsHalfToEvenForPositiveTies(): void
    {
        $ledger = new EarningsLedger();

        $this->assertSame(2.34, $ledger->roundForPayout(2.345, EarningsLedger::ROUND_BANKERS));
        $this->assertSame(2.36, $ledger->roundForPayout(2.355, EarningsLedger::ROUND_BANKERS));
    }

    public function testBankersNeverChangesTheResultForNegativeTies(): void
    {
        $ledger = new EarningsLedger();

        // floor() moves away from zero for negatives, so the banker's branch
        // never changes the result there: an odd floor (-2.345) falls through
        // to round(), and an even floor (-2.355) takes the tie branch but
        // returns the same half-away-from-zero value.
        $this->assertSame(-2.35, $ledger->roundForPayout(-2.345, EarningsLedger::ROUND_BANKERS));
        $this->assertSame(-2.36, $ledger->roundForPayout(-2.355, EarningsLedger::ROUND_BANKERS));
    }

    public function testBalanceMixesCurrenciesOneToOne(): void
    {
        $ledger = new EarningsLedger();
        $ledger->credit(9, '10.00', 'USD', 'tips');
        $ledger->credit(9, '5.00', 'EUR', 'eu tips');

        // EUR entries are summed as if they were USD.
        $this->assertEqualsWithDelta(15.0, $ledger->balance(9), 0.0001);
        $this->assertEqualsWithDelta(15.0, $ledger->balance(9, 'EUR'), 0.0001);
    }

    public function testPayableIsNegativeDespiteDocblock(): void
    {
        $ledger = new EarningsLedger();
        $ledger->credit(9, '10.00');
        $ledger->adjust(9, '-12.50', 'USD', 'clawback');

        $this->assertSame(-2.5, $ledger->payable(9));
    }

    public function testEntriesKeepRawAmountTypes(): void
    {
        $ledger = new EarningsLedger();
        $ledger->credit(9, '10.00');
        $ledger->credit(9, 2.5);

        $entries = $ledger->entries(9);

        $this->assertSame('10.00', $entries[0]['amount']);
        $this->assertSame(2.5, $entries[1]['amount']);
        $this->assertSame(2, $ledger->entryCount(9));
    }
}
`,
  },
  {
    path: "tests/Moderation/ChatSentinelTest.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Moderation;

use CreatorEx\Moderation\ChatSentinel;
use PHPUnit\Framework\TestCase;

final class ChatSentinelTest extends TestCase
{
    public function testBlocklistMatchesCaseInsensitively(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame(['casino'], $sentinel->violations('Join our CASINO night'));
    }

    public function testSubstringMatchFlagsLegitWords(): void
    {
        $sentinel = new ChatSentinel();

        // 'crypto' matches inside longer words: pinned, not fixed.
        $this->assertSame(['crypto'], $sentinel->violations('Crypto news today'));
    }

    public function testLeetspeakEvadesTheBlocklist(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame([], $sentinel->violations('fr33 m0ney for everyone'));
        $this->assertTrue($sentinel->isClean('fr33 m0ney for everyone'));
    }

    public function testRedactsEmails(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame('contact [email] today', $sentinel->redact('contact creator@ex.com today'));
    }

    public function testRedactsFormattedPhoneNumbers(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame('text [phone] please', $sentinel->redact('text +1 (555) 010-2030 please'));
    }

    public function testBareShortPhonesLeakThrough(): void
    {
        $sentinel = new ChatSentinel();

        // Seven digits are below the pattern's length threshold: no redaction.
        $this->assertSame('call 5550102 now', $sentinel->redact('call 5550102 now'));
    }

    public function testDatesAreMangledDespiteNoFalsePositivesPromise(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame('premiere on [phone]!', $sentinel->redact('premiere on 2026-01-15!'));
    }

    public function testSnippetWindowIsLengthNotOffset(): void
    {
        $sentinel = new ChatSentinel();
        $text = 'ok casino ' . str_repeat('x', 60);

        // substr($text, -17, 23): a negative start counts from the end, and
        // the third argument is a length, not an end offset.
        $this->assertSame(str_repeat('x', 17), $sentinel->snippetAround($text, 'casino'));
        $this->assertSame('', $sentinel->snippetAround($text, 'crypto'));
    }
}
`,
  },
  {
    path: "tests/Support/LegacyHelpersTest.php",
    content: String.raw`
<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Support;

use function CreatorEx\Support\creatorex_format_date;
use function CreatorEx\Support\creatorex_money_string;
use function CreatorEx\Support\creatorex_pluck;

use PHPUnit\Framework\TestCase;

final class LegacyHelpersTest extends TestCase
{
    public function testPluckIncludesNullsForMissingKeys(): void
    {
        $rows = [['id' => 1, 'name' => 'ada'], ['id' => 2]];

        $this->assertSame(['ada', null], creatorex_pluck($rows, 'name'));
    }

    public function testPluckHandlesNonArrayRows(): void
    {
        $this->assertSame([1, null, null], creatorex_pluck([['v' => 1], 'scalar', null], 'v'));
    }

    public function testPluckReadsObjectProperties(): void
    {
        $plain = new \stdClass();
        $plain->v = 4;

        $this->assertSame([4, 9], creatorex_pluck([$plain, (object) ['v' => 9]], 'v'));
    }

    public function testFormatDateHandlesUnixTimestamps(): void
    {
        $this->assertSame('2026-01-15 10:30', creatorex_format_date(1768473000));
    }

    public function testNumericTimezoneShiftsHours(): void
    {
        $this->assertSame('2026-01-15 12:30', creatorex_format_date(1768473000, 2));
        $this->assertSame('2026-01-15 08:30', creatorex_format_date(1768473000, -2));
    }

    public function testNamedTimezonesAreSilentlyIgnored(): void
    {
        // (int) 'Europe/Berlin' is 0, so the named zone never shifts output.
        // DST is not handled; true Berlin time in January would be 11:30.
        $this->assertSame('2026-01-15 10:30', creatorex_format_date('2026-01-15T10:30:00Z', 'Europe/Berlin'));
    }

    public function testMoneyStringRoundsViaSprintf(): void
    {
        // sprintf('%.2f') rounds to nearest; it does not truncate.
        $this->assertSame('13.00', creatorex_money_string('12.999'));
        $this->assertSame('7.00', creatorex_money_string(7));
    }
}
`,
  },
];

function normalize(raw: string): string {
  return `${raw.replace(/^\n/, "").replace(/\s+$/, "")}\n`;
}

function isCommentOnly(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("#")
  );
}

function countLines(content: string): { physical: number; nonBlank: number; code: number } {
  const lines = content.split("\n").slice(0, -1); // drop the trailing-newline stub
  let nonBlank = 0;
  let code = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    nonBlank += 1;
    if (!isCommentOnly(line)) code += 1;
  }
  return { physical: lines.length, nonBlank, code };
}

function main(): void {
  clearOutRoot(outRoot);

  const digest = createHash("sha256");
  const width = Math.max(...FILES.map((f) => f.path.length));
  const rows: { group: string; label: string; stats: { physical: number; nonBlank: number; code: number } }[] = [];

  for (const file of FILES) {
    const content = normalize(file.content);
    const abs = join(outRoot, ...file.path.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");

    digest.update(file.path, "utf8");
    digest.update("\u0000", "utf8");
    digest.update(content, "utf8");
    digest.update("\u0000", "utf8");

    rows.push({
      group: file.path.startsWith("tests/")
        ? "tests"
        : file.path.endsWith(".php")
          ? "src"
          : "meta",
      label: `  ${file.path.padEnd(width)}  ${String(countLines(content).physical).padStart(4)} lines`,
      stats: countLines(content),
    });
  }

  const sum = (group: string, pick: (s: { physical: number; nonBlank: number; code: number }) => number): number =>
    rows.filter((r) => r.group === group).reduce((acc, r) => acc + pick(r.stats), 0);

  const fileCount = (group: string): number => rows.filter((r) => r.group === group).length;

  console.log(`fixtures/creatorex-middleware written: ${FILES.length} files`);
  for (const row of rows) console.log(row.label);
  console.log("");
  console.log(
    `src:   ${fileCount("src")} files, ` +
      `${sum("src", (s) => s.physical)} lines ` +
      `(${sum("src", (s) => s.nonBlank)} non-blank, ${sum("src", (s) => s.code)} code)`,
  );
  console.log(
    `tests: ${fileCount("tests")} files, ` +
      `${sum("tests", (s) => s.physical)} lines ` +
      `(${sum("tests", (s) => s.nonBlank)} non-blank, ${sum("tests", (s) => s.code)} code)`,
  );
  console.log("");
  console.log(`DIGEST sha256: ${digest.digest("hex")}`);
}

main();
