/**
 * Tiny dependency-free assert + runner for standalone unit tests.
 *
 * Deliberately does NOT use node:assert — these files must type-check and run
 * with zero @types/node (nothing may fight worker-1's package.json). Run any
 * test file directly: `bun run <file>`.
 */

export function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`assert failed: ${message}`);
  }
}

export function assertEquals(actual: unknown, expected: unknown, message = ""): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `assert failed: ${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

/** Asserts fn throws an Error whose message contains the given substring. */
export function assertThrows(fn: () => void, expectedSubstring: string): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  if (thrown === null) {
    throw new Error(`assert failed: expected throw containing "${expectedSubstring}", nothing thrown`);
  }
  const text = thrown instanceof Error ? thrown.message : String(thrown);
  if (!text.includes(expectedSubstring)) {
    throw new Error(
      `assert failed: expected throw containing "${expectedSubstring}", got "${text}"`,
    );
  }
}

/** Structural deep equality (plain JSON shapes only — no Dates/Maps/etc). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as Record<string, unknown>).sort();
    const kb = Object.keys(b as Record<string, unknown>).sort();
    if (!deepEqual(ka, kb)) {
      return false;
    }
    return ka.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }
  return false;
}

/** Runs the suite, prints one line per test, throws if anything failed. */
export function runTestFile(
  suite: string,
  tests: Record<string, () => void>,
): void {
  let failed = 0;
  for (const [name, test] of Object.entries(tests)) {
    try {
      test();
      console.log(`  ok   ${suite} > ${name}`);
    } catch (err) {
      failed += 1;
      const text = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL ${suite} > ${name}\n       ${text}`);
    }
  }
  if (failed > 0) {
    throw new Error(`${suite}: ${failed} of ${Object.keys(tests).length} tests failed`);
  }
  console.log(`${suite}: ${Object.keys(tests).length} passed`);
}
