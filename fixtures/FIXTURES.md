# Fixtures

Generated demo input for the porting demo: a small PHP invoicing/catalog module
(namespace `Acme\Billing`) plus PHPUnit-style tests. **Everything under
`php-sample/` is generated output — do not edit it by hand.** Edit
`fixtures/generate.ts` and re-run.

## Regenerate

```sh
bun run fixtures/generate.ts        # or: npx tsx fixtures/generate.ts
```

The script is standalone (imports only `node:` builtins — no package.json,
tsconfig, or node_modules dependency) and deterministic: no randomness, no
clock, fixed file order, LF endings, one trailing newline per file. Running it
twice is byte-identical; compare the printed `DIGEST sha256` line.

Current digest of the generated tree:

```
76728d34a578a21d0b364ba5a5de1c603e61cff903750a055f22b050900196f9
```

Verified on 2026-09-25: two consecutive runs produced identical stdout and
identical per-file `shasum -a 256` checksums.

## Inventory

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
| `tests/MoneyTest.php` | 61 | 47 |
| `tests/PricingTest.php` | 51 | 38 |
| `tests/InvoiceTest.php` | 79 | 62 |
| `tests/InvoiceRepositoryTest.php` | 97 | 74 |
| **tests total (4 files)** | **288** | **221 (218 code)** |

Per-file counts are also printed by the generator on every run.

## PHP idiom map

| Idiom | Where |
|---|---|
| Associative arrays as pseudo-objects | `Customer` attribute bag (`array_merge` defaults + magic accessors); `Product::fromArray`, `Invoice` line items, `InvoiceRepository` row store |
| Mixed / nullable params | `Customer` (`id`/`email`/`vat_number` null defaults, `creditLimit()` null passthrough); `InvoiceRepository::save($createdAt = null)`; `Product($metadata = null)`; untyped `$units` in `DiscountPolicy::apply` |
| Scalar coercions | `Money` ctor `(float)`/`(string)`; `Money::parse` (str_replace + cast); `Money::multiply` operator coercion of `"2.5"`; `PercentageDiscount` `(float)`; `FlatRateDiscount` `(int)`; `Invoice::addLine` `(int)` quantity; `InvoiceRepository::totalByCurrency` `(float)` on `"123.45 USD"` |
| Late static binding | `PercentageDiscount::of` (`new static` — dead: class is `final`) |
| Magic methods | `Customer::__get` / `__isset`; `Money::__toString`; `Invoice::__toString` |
| Loose comparison | `Money::equals` (`amount ==`), `Invoice::quantityForSku` (`sku ==`, so `'9001' == 9001`) |
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
- **Phase 7 (fixture at scale)**: the full demo run ports the entire
  `php-sample/` module.
- The PHP fixture is read-only input; no PHP toolchain runs anywhere in the
  pipeline. Expected TS output lives outside `fixtures/` (owned by the porting
  loop, not by this generator).
