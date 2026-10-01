/**
 * Env isolation for tests that depend on harness/lane configuration.
 *
 * Bun auto-loads the operator's `.env` (README tells operators to put the
 * OPENCODE_* lane overrides there), so a "defaults" test that only cleans up
 * AFTER itself sees the real environment on its first run (audit C22/C78).
 * Call clearHarnessEnv() in beforeEach and run the returned restore function
 * in afterEach.
 */

const ISOLATED_PREFIXES = ["OPENCODE_", "TYPESAFE_"] as const;

/** Deletes every OPENCODE_* / TYPESAFE_* variable and returns a restore function. */
export function clearHarnessEnv(): () => void {
  const saved = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ISOLATED_PREFIXES.some((p) => key.startsWith(p))) {
      saved.set(key, value);
    }
  }
  for (const key of saved.keys()) delete process.env[key];
  return () => {
    // Drop anything the test set, then put the original values back.
    for (const key of Object.keys(process.env)) {
      if (ISOLATED_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
    }
    for (const [key, value] of saved) process.env[key] = value;
  };
}
