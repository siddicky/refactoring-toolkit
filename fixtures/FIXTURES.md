# Fixtures

Two generated demo inputs, both deterministic:

1. **`php-sample/`** — a small PHP invoicing/catalog module (`Acme\Billing`),
   the original fixture used by the Phase 2 trial gate and the Phase 7 full run.
2. **`creatorex-middleware/`** — a creator-platform middleware module
   (`CreatorEx\*`: subscriptions, video paywall, creator payouts, chat
   moderation), framed for a VP of Engineering running a legacy-PHP →
   TypeScript platform modernization. Sized for a live demo: each source file
   is one implement → review → fix cycle.

**Everything under `php-sample/` and `creatorex-middleware/` is generated
output — do not edit it by hand.** Edit the generator and re-run. That
includes `creatorex-middleware/prep-stub.md`: the generator emits it, so
regenerating reproduces it byte for byte instead of deleting it.
`tests/fixtures-generators.test.ts` enforces this by regenerating both
fixtures into a temp dir and comparing file set, bytes, and the digests below.

## Regenerate

```sh
bun run fixtures/generate.ts              # or: npx tsx fixtures/generate.ts
bun run fixtures/generate-creatorex.ts    # or: npx tsx fixtures/generate-creatorex.ts
```

Each run wipes its output directory first and rewrites every file. Pass
`--out <dir>` (or `--out=<dir>`) to write somewhere else (the tests use a temp dir; `--out` is the only option, and any other argument is an error); the wipe is
refused for a non-empty directory that lacks the `GENERATED.txt` marker, so a
wrong `--out` cannot delete a directory the generator does not own.

Both scripts are standalone (imports only `node:` builtins — no package.json,
tsconfig, or node_modules dependency, and no shared code between them) and
deterministic: no randomness, no clock, fixed file order, LF endings, one
trailing newline per file. Running either twice is byte-identical; compare the
printed `DIGEST sha256` line.

Current digests:

```
php-sample:            0e16824ab8b5c28a1cde62400d9c6c7bd8e824e148db6664c55dbc2603800541
creatorex-middleware:  72b8f99b60711d9d6cd6d72d9e40f42ed946ec6eae97733cd316d994597bc7dc
```

Verified on 2026-09-30: for each fixture, two consecutive runs produced
identical stdout and identical per-file `shasum -a 256` checksums, and the
output equals the committed tree.

## Fixture 1 — `php-sample/` inventory

LOC is counted as non-blank lines; "code" additionally excludes comment-only
lines. (Total physical lines shown per file for reference.)

| File | Physical | LOC (non-blank) |
|---|---:|---:|
| `src/Money.php` | 109 | 88 |
| `src/Customer.php` | 90 | 73 |
| `src/Product.php` | 127 | 105 |
| `src/Support/Arrayable.php` | 13 | 10 |
| `src/Support/Taggable.php` | 60 | 49 |
| `src/Pricing/DiscountPolicy.php` | 20 | 16 |
| `src/Pricing/PercentageDiscount.php` | 42 | 33 |
| `src/Pricing/FlatRateDiscount.php` | 33 | 25 |
| `src/Invoice.php` | 173 | 145 |
| `src/InvoiceRepository.php` | 110 | 92 |
| **src total (10 files)** | **777** | **636 (495 code)** |
| `tests/MoneyTest.php` | 63 | 49 |
| `tests/PricingTest.php` | 52 | 39 |
| `tests/InvoiceTest.php` | 86 | 69 |
| `tests/InvoiceRepositoryTest.php` | 97 | 74 |
| **tests total (4 files)** | **298** | **231 (220 code)** |

Per-file counts are also printed by the generator on every run.

## PHP idiom map

| Idiom | Where |
|---|---|
| Associative arrays as pseudo-objects | `Customer` attribute bag (`array_merge` defaults + magic accessors); `Product::fromArray`, `Invoice` line items, `InvoiceRepository` row store |
| Mixed / nullable params | `Customer` (`id`/`email`/`vat_number` null defaults, `creditLimit()` null passthrough); `InvoiceRepository::save($createdAt = null)`; `Product($metadata = null)`; untyped `$units` in `DiscountPolicy::apply` |
| Scalar coercions | `Money` ctor `(float)`/`(string)`; `Money::parse` (str_replace + cast); `Money::multiply` operator coercion of `"2.5"`; `PercentageDiscount` `(float)`; `FlatRateDiscount` `(int)`; `Invoice::addLine` `(int)` quantity; `InvoiceRepository::totalByCurrency` `(float)` on `"123.45 USD"` |
| Late static binding | `PercentageDiscount::of` (`new static` — dead: class is `final`) |
| Magic methods | `Customer::__get` / `__isset`; `Money::__toString`; `Invoice::__toString` |
| Loose comparison | `Invoice::quantityForSku` (`sku ==`, so `'9001' == 9001` and `'9001' == '9001.0'`); `Money::equals` also spells `amount ==`, but the constructor casts both sides to float, so it behaves exactly like `===` (a `==` site, not an observable trap) |
| Traits | `Support\Taggable`, used by `Product` and `Invoice` |
| Interfaces | `Support\Arrayable` (Product, Invoice), `Pricing\DiscountPolicy`, `\Countable` (InvoiceRepository) |
| By-reference iteration | `InvoiceRepository::totalByCurrency` (`&$row` foreach + `unset`) |
| Duck typing | `Taggable::mergeTagsFrom` (any object with `tags()`); `Product::cheaperThan` (Product or raw row array); invoice line "product" |
| Variadics | `Taggable::addTags(...$tags)` |
| Named constructors | `Money::parse`, `Customer::fromArray`, `Product::fromArray`, `PercentageDiscount::of` |
| Formatted-string money | `sprintf('%.2f %s', ...)` in `Money::__toString`; totals stored as `"43.98 USD"` strings via `Invoice::toArray`, re-parsed by `(float)` in the repository |

## Deliberately misleading docblocks (the port must not trust them)

1. `Money` class doc: "always non-negative" — `subtract()` produces negatives;
   pinned by `MoneyTest::testSubtractMayGoNegative` (`-3.00 USD`).
2. `Product::$priceCents`: "always integers in cents" — the constructor accepts
   any scalar and `fromArray` passes raw row values.
3. `Invoice::addLine`: claims required keys product + int quantity and that the
   `note` key is "ignored" — note is kept, quantity is coerced, product is
   duck-typed.
4. `InvoiceRepository::find`: `@return Invoice[]` — actually returns a single
   `Invoice` or null.
5. `Taggable`: "entities of the same class" for `mergeTagsFrom` — nothing
   enforces it; "always flat strings" holds only via silent coercion.
6. `PercentageDiscount::of`: "so that subclasses resolve to their own class" —
   the class is `final`, so the late static binding is dead.

Related behavioral traps (documented in `stub-prep.md` §4): repository
round-trip loses the customer name; PHP `round()` is half away from zero
(`10.125 → 10.13`); cross-currency adds throw inside `Invoice::subtotal()`.

## What consumes this

- **Phase 2 (trial gate)**: the core loop consumes `fixtures/stub-prep.md`
  (marked STUB) plus seed files from `php-sample/`.
- **Phase 7 (fixture at scale)**: the full demo run ports the `php-sample/`
  source module (the 10 `src/` files). The 4 `tests/*.php` files are not port
  units here: `stub-prep.md` has only the glob row `tests/*.php`, which
  `parsePrepSourceMap` skips, unlike creatorex, whose test files have explicit
  rows in `prep-stub.md`.
- The PHP fixture is read-only input; no PHP toolchain runs anywhere in the
  pipeline. Expected TS output lives outside `fixtures/` (owned by the porting
  loop, not by this generator).
- No PHP version is pinned because nothing executes the PHP. The tests avoid
  assertions whose outcome changed between PHP 7 and 8: `'9001' == '9001 '` is
  false before 8.0 and true from 8.0 (trailing whitespace became allowed in
  numeric strings), so `InvoiceTest` pins `'9001.0'` (matches) and `'9001abc'`
  (does not) instead.

---

## Fixture 2 — `creatorex-middleware/` (creator platform)

**Audience framing:** a VP of Engineering running a legacy-PHP → TypeScript
platform modernization at a creator-platform company. The four modules mirror
the real migration surface — payments/subscriptions, video paywall, creator
payouts, chat moderation — plus the `legacy_helpers.php` file every such
codebase owns. Each source file is deliberately sized for one
implement → review → fix cycle in a live demo. Same discipline as
`php-sample/`: **tests pin real behavior; docblocks lie.**

### Inventory

LOC = non-blank lines; "code" excludes comment-only lines.

| File | Physical | LOC (non-blank) |
|---|---:|---:|
| `src/Billing/SubscriptionService.php` | 173 | 143 |
| `src/Access/EntitlementChecker.php` | 98 | 81 |
| `src/Payouts/EarningsLedger.php` | 108 | 91 |
| `src/Moderation/ChatSentinel.php` | 76 | 64 |
| `src/Support/legacy_helpers.php` | 59 | 51 |
| **src total (5 files)** | **514** | **430 (307 code)** |
| `tests/Billing/SubscriptionServiceTest.php` | 135 | 103 |
| `tests/Access/EntitlementCheckerTest.php` | 126 | 96 |
| `tests/Payouts/EarningsLedgerTest.php` | 72 | 56 |
| `tests/Moderation/ChatSentinelTest.php` | 74 | 55 |
| `tests/Support/LegacyHelpersTest.php` | 59 | 46 |
| **tests total (5 files)** | **466** | **356 (334 code)** |

### Landmine map

| File | Landmines (all pinned by tests) |
|---|---|
| `src/Billing/SubscriptionService.php` | Money as float+string mix: `'12.99'` vs `29.99` prices, `balance_due` rebuilt via `(float)+(float)` then `(string)`. Loose `==` on plan codes: `'100'` resolves for int `100`, but `'premium'`/`'Premium'` are *different* plans and `'PREMIUM'` misses → `??` substitutes `'0.00'` (mistyped codes are free). Lying docblock: `applyCharge` claims declines "never throw" — hard declines throw `RuntimeException`. Grace window checks only an upper bound. Dunning transitions via an explicit allowed-map (`trialing → past_due` is legal). |
| `src/Access/EntitlementChecker.php` | Geo gate via non-strict `in_array`: int `840` matches legacy alias `'840'`, lowercase `'us'` is denied. Null-coalescing traps: `'0'` entitlement short-circuits the `??` lookup (denied), `null` falls through; `requireEntitlement(false)` disables the whole check via `?? false`. Magic `__call` fluent `require*` gates: only names that do *not* start with `require` throw `BadMethodCallException`, while an unknown `require*` name (e.g. `requireFriendInvite()`) silently registers a gate that `decide()` never evaluates; gates are sticky mutable state until `resetGates()`. Array-shape session rows; `$content` param and `requireGeo()` argument are silently unused. |
| `src/Payouts/EarningsLedger.php` | Rounding drift: half-away-from-zero (`round`) vs banker's (custom branch) — `2.345 → 2.35 / 2.34`; the banker's branch never changes the result for negatives (`floor` moves away from zero: an odd floor falls through to `round()`, an even floor takes the tie branch but returns the same half-away value, e.g. `-2.355 → -2.36`). USD/EUR entries summed 1:1, `balance()` currency argument ignored. "Never negative" docblock on `payable()` contradicted by a pinned `-2.5` payout. Raw amount types preserved per entry (string `'10.00'` vs float `2.5`). |
| `src/Moderation/ChatSentinel.php` | Substring blocklist: `'crypto'` matches inside `'Crypto news'` (false positive on legit content) while leetspeak `'fr33 m0ney'` evades entirely. Phone regex redacts the date `'2026-01-15'` → `[phone]`, contradicting the "no false positives on stored content" docblock; bare 7-digit phones leak below the length threshold. `snippetAround` passes `$pos + 20` as the *length* argument (and a negative start counts from the end) — pinned to a 17-char window from the tail. |
| `src/Support/legacy_helpers.php` | `creatorex_pluck` yields `null` for missing keys / non-array rows (not skipped) and reads object properties. `creatorex_format_date` claims "Timezones and DST are handled" — named zones are silently ignored (`(int) 'Europe/Berlin' === 0`), numeric zones are fixed-hour shifts, DST never handled. `creatorex_money_string` rounds via `sprintf('%.2f')` — a third rounding behavior, distinct from `round()` and the banker's path in the ledger. |

### Idioms shared with php-sample

Associative arrays as pseudo-objects (subscription/entitlement/ledger/session
rows), mixed/nullable params, coercions (`(int)`/`(float)`/`(string)` at every
boundary), magic methods (`__call`, in addition to `__get`/`__isset`/
`__toString` in php-sample), loose `==` (plan codes, `fmod($lower, 2) == 0`,
non-strict `in_array`), namespaced global functions (`use function`), explicit
state-machine map (dunning), fluent APIs via `__call`.

### What consumes fixture 2

Optional live-demo input for the same porting flow; not wired into the
Phase 2/Phase 7 defaults, which point at `php-sample/` and `stub-prep.md`.
`run-demo.ts demo --files creatorex` expands to the 10 port units (5 source
files + 5 PHPUnit test files) and implies this fixture's prep stub and source
root, so this is the whole command:

```sh
bun run scripts/run-demo.ts demo --dir <targetRepoDir> --files creatorex
```

An explicit `--prep` or `--source-root` still wins over the implied one. Any
other `--files` value uses the php-sample defaults (`stub-prep.md`,
`php-sample/`), which have no source-map rows for the creatorex files; `demo`
reports that in its preflight, before it contacts dex. Both fixture locations
are found from the script, not the current directory.

`--dir` must be an existing git repository with a commit. Add `--init-fixture`
to have `demo` (or `round`) create a throwaway README-only repository at a path
that does not exist yet (`src/git/fixture.ts`); an existing directory is never
touched. The `round` command, the Phase-0 probe, expects exactly that kind of
repository.

`creatorex-middleware/prep-stub.md` is the stub prep artifact: a hand-written
source map (the test files are explicit rows, because `parsePrepSourceMap`
skips glob rows such as `tests/*.php`). The generator emits it like every other
file in the directory, and `tests/vitest-honesty.test.ts` reads it. Treat
it as a stub until Phase 3 prep-analysis produces the real thing.
