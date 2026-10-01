/**
 * Env isolation for tests that depend on configuration read from the
 * environment.
 *
 * Bun auto-loads the operator's `.env` (README tells operators to put the
 * OPENCODE_* lane overrides, STATUS_HOST, DEX_SERVER_ADDRESS and friends there),
 * so a "defaults" test that only cleans up AFTER itself sees the real
 * environment on its first run (audit C22/C78), and a test that hands
 * `{ ...process.env }` to a child process leaks it (B31: STATUS_HOST=localhost
 * failed tests/run-demo-dashboard.test.ts).
 *
 * - {@link clearHarnessEnv}: for tests that read the environment in-process.
 *   Call it in beforeEach and run the returned restore function in afterEach.
 * - {@link isolatedEnv}: for tests that spawn a child: a copy of the environment
 *   without any toolkit variable, plus the overrides the test names.
 *
 * tests/env-isolation.test.ts re-runs the suites with a polluted environment.
 */

const ISOLATED_PREFIXES = ["OPENCODE_", "TYPESAFE_", "STATUS_", "DEX_"] as const;
const ISOLATED_NAMES = [
  "DEXCLI_BIN",
  "KILL_EVENT_FILES",
  "BURN_DOWN_FILES",
  "HARNESS",
  "RECOVER_FILE",
  "RECOVER_ROUND",
  "PORTING_KIT_FAULT",
] as const;

const isIsolated = (key: string): boolean =>
  ISOLATED_PREFIXES.some((p) => key.startsWith(p)) || (ISOLATED_NAMES as readonly string[]).includes(key);

/** Deletes every toolkit variable (OPENCODE_*, TYPESAFE_*, STATUS_*, DEX_*, ...) and returns a restore function. */
export function clearHarnessEnv(): () => void {
  const saved = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isIsolated(key)) saved.set(key, value);
  }
  for (const key of saved.keys()) delete process.env[key];
  return () => {
    // Drop anything the test set, then put the original values back.
    for (const key of Object.keys(process.env)) {
      if (isIsolated(key)) delete process.env[key];
    }
    for (const [key, value] of saved) process.env[key] = value;
  };
}

/** The current environment without any toolkit variable, plus `overrides`: what to hand a child process. */
export function isolatedEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isIsolated(key)) env[key] = value;
  }
  return { ...env, ...overrides };
}
