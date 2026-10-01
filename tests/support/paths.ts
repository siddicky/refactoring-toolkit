/**
 * Test helper (not a test file): where the repository is, wherever a test sits.
 *
 * Colocated unit tests (src/**, harness/**) and tests/*.test.ts live at
 * different depths, so none of them may derive the repo root from its own
 * location. Import REPO_ROOT instead.
 */

import { join } from "node:path";

/** Absolute path of the repository root. */
export const REPO_ROOT = join(import.meta.dir, "..", "..");
