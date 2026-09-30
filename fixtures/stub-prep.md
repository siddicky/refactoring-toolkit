# PORTING PREP — `Acme\Billing` PHP → TypeScript

> **STATUS: STUB — TRIAL-GATE ARTIFACT (Phase 2).**
> This is a hand-written stand-in for the prep-analysis outputs. The Phase 2 core
> loop consumes this file so the loop has a realistic artifact to work from.
> **Phase 3 (prep-analysis) replaces it** with a generated spec map plus a
> per-symbol table, each adversarially reviewed before use. These contents are
> neither complete nor adversarially reviewed — do not extend or trust them
> beyond the trial run.

## 1. Source map

Module root: `fixtures/php-sample/` — namespace `Acme\Billing` (PSR-4: `src/`),
tests in `tests/` (PHPUnit style; the port targets vitest). The PHP side is
read-only input; no PHP toolchain runs anywhere in the pipeline.

| PHP file | Proposed port target | Notes |
|---|---|---|
| `src/Money.php` | `src/money.ts` | value object; decide `number` cents vs float major-unit; needs shared round helper |
| `src/Customer.php` | `src/customer.ts` | attribute bag + magic accessors → named interface + explicit accessors |
| `src/Product.php` | `src/product.ts` | trait composition → explicit mixin/state field |
| `src/Support/Arrayable.php` | `src/support/arrayable.ts` | interface only |
| `src/Support/Taggable.php` | `src/support/taggable.ts` | PHP trait → TS has none: mixin helper + tags state |
| `src/Pricing/DiscountPolicy.php` | `src/pricing/discount-policy.ts` | interface |
| `src/Pricing/PercentageDiscount.php` | `src/pricing/percentage-discount.ts` | late static binding, see §4 |
| `src/Pricing/FlatRateDiscount.php` | `src/pricing/flat-rate-discount.ts` | |
| `src/Invoice.php` | `src/invoice.ts` | aggregates assoc-array line items → named types |
| `src/InvoiceRepository.php` | `src/invoice-repository.ts` | in-memory row store; string-stored numbers |
| `tests/*.php` | `test/*.test.ts` | PHPUnit asserts → vitest `expect` |

## 2. Mapping conventions (stub)

| PHP construct | TS target | Rule |
|---|---|---|
| untyped parameter | union inferred from call sites + tests | never widen to `any` |
| `mixed` | `unknown` | narrow at the boundary |
| nullable (`null` return, `??`, `isset`) | `T \| null` + explicit guard | |
| associative array as pseudo-object | named `interface` + parser at construction | each row shape gets its own type |
| scalar coercion (`(int)`, `(float)`, arithmetic on strings) | explicit `Number()` / `parseInt` helper | document the failure mode: PHP yields 0 + warning on non-numeric; TS yields `NaN` |
| loose `==` | decide intended semantics per site; default `===` | flag every replaced site in the per-symbol table |
| late static binding (`new static`, `static::`) | class-token factory or per-class static factory | see §4 item 4 |
| magic methods (`__get`, `__isset`, `__toString`) | explicit accessors / `toString()` | no dynamic property surface in the port |
| by-reference iteration (`&$row`) | mutate via index or return a new structure | no TS aliasing surprises |
| duck typing (`$other->tags()`) | structural type | |
| traits | helper object / mixin type + composition | |
| variadics (`...$tags`) | rest parameters | |
| named constructors (`Money::parse`, `PercentageDiscount::of`) | static factory on the class | |
| `sprintf('%.2f %s', ...)` | `toFixed(2) + ' ' + currency` via a shared formatter | rounding: PHP `round()` is half away from zero; `toFixed` differs on ties — port the helper, not the call |
| PHPUnit `TestCase` | vitest `describe/it/expect` | `expectException` → `expect(...).toThrow()` |

## 3. Per-symbol table (excerpt)

Flags: `MISLEADING_DOC` `COERCION` `NULLABLE` `ASSOC_ARRAY` `MAGIC` `LSB`
`LOOSE_EQ` `DUCK` `REF` `FORMAT`

| Symbol | Kind | File | Evidence | Proposed TS type | Flags |
|---|---|---|---|---|---|
| `Money::$amount` | prop | src/Money.php | ctor casts to float; class doc claims "always non-negative" but `subtract()` yields negatives (test asserts `-3.00 USD`) | `number` | MISLEADING_DOC, COERCION |
| `Money::parse` | static | src/Money.php | strips spaces/commas; empty input returns zero | `(raw: string \| number, currency?: string) => Money` | COERCION |
| `Money::equals` | method | src/Money.php | `$this->amount == $other->amount` is spelled as a loose compare, but the ctor casts both amounts to float, so `==` and `===` behave identically here (a `==` site, not an observable trap); currency uses `===` | `(other: unknown) => boolean` | LOOSE_EQ |
| `Customer::$attributes` | prop | src/Customer.php | `array_merge` over defaults; magic `__get`/`__isset` expose unknown keys | `CustomerProps` interface + `Record<string, unknown>` extras | ASSOC_ARRAY, MAGIC |
| `Customer::creditLimit` | method | src/Customer.php | stored as `'0.00'` numeric string; null passthrough | `() => Money \| null` | COERCION, NULLABLE |
| `Product::$priceCents` | prop | src/Product.php | doc says "always integers in cents"; ctor accepts any scalar; rows may hold `"1999"`; `price()` divides by 100 | `number` (cents) | MISLEADING_DOC, COERCION |
| `Product::cheaperThan` | method | src/Product.php | `is_array` branch; same-class private property access on the object branch | `(other: Product \| CatalogRow) => boolean` | DUCK |
| `PercentageDiscount::of` | static | src/Pricing/PercentageDiscount.php | `new static` inside a `final` class — LSB can never resolve to a subclass | factory: `(percent: number) => PercentageDiscount` | LSB (dead), MISLEADING_DOC |
| `DiscountPolicy::apply` | method | src/Pricing/DiscountPolicy.php | `$units` untyped in the interface; implementations coerce `(int)` / multiply | `(subtotal: Money, units: number) => Money` | COERCION |
| `Invoice::addLine` | method | src/Invoice.php | doc claims product+int quantity required and "note ignored" — note is in fact kept, quantity coerced from strings, product duck-typed | `(line: InvoiceLineInput) => this` | MISLEADING_DOC, ASSOC_ARRAY, COERCION |
| `Invoice::quantityForSku` | method | src/Invoice.php | `sku() == $sku` loose compare; numeric-string SKUs match ints (`'9001' == 9001`) | `(sku: string \| number) => number` | LOOSE_EQ |
| `Invoice::toArray` | method | src/Invoice.php | totals embedded as `"43.98 USD"` formatted strings | `() => InvoiceRow` | FORMAT |
| `InvoiceRepository::find` | method | src/InvoiceRepository.php | docblock says `@return Invoice[]` but the method returns a single `Invoice` or null | `(number: string) => Invoice \| null` | MISLEADING_DOC, NULLABLE |
| `InvoiceRepository::totalByCurrency` | method | src/InvoiceRepository.php | `&$row` by-reference foreach; parses `"123.45 USD"` via `(float)` cast (leading-numeric read) | `() => Record<string, number>` | REF, COERCION, FORMAT |
| `Taggable::mergeTagsFrom` | method | src/Support/Taggable.php | doc says "entities of the same class" — nothing enforces it; any object exposing `tags()` works | `<T extends { tags(): string[] }>(other: T) => this` | DUCK, MISLEADING_DOC |
| `Customer::__get` | magic | src/Customer.php | unknown keys → `E_USER_NOTICE` + null return | explicit `get(name: string): unknown` | MAGIC |

## 4. Known traps (for reviewers; not exhaustive)

1. **Round-trip data loss** — `InvoiceRepository::hydrate` cannot restore the
   customer name (rows never carry it); a test pins the `'unknown'` fallback.
2. **Rounding** — `Money::percentage` uses PHP `round()` (half away from zero);
   a naive TS `toFixed` port behaves differently on ties. Tests pin
   `10.125 → 10.13`.
3. **Formatted-string money** — `totalByCurrency` float-parses `"19.99 USD"`
   with an explicit `(float)` cast. PHP reads the leading numeric part
   silently (an explicit cast raises no warning on any version); TS `Number()`
   produces `NaN`. The port must decide and document the gap.
4. **Dead late static binding** — `PercentageDiscount` is `final` yet `of()`
   advertises subclass resolution via `new static`. The port should not invent
   a subclass hook.
5. **Docblocks lie** — every symbol flagged `MISLEADING_DOC` above contradicts
   observed behavior. Treat tests and call sites as ground truth, never docs.
6. **Cross-currency composition** — `Invoice::subtotal()` adds each product's
   price (in the product's currency) to an invoice-currency zero; mismatched
   currencies throw at runtime in PHP. The TS port must choose: keep the throw,
   or type the constraint away.
