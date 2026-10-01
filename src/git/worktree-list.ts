/**
 * The one parser of `git worktree list --porcelain` (audit C49: the dashboard
 * and `run-demo.ts recover-port` each carried a copy, with different rules for
 * where a record ends and how a detached HEAD is spelled). A leaf module: pure
 * text in, records out, no process spawning, so the read-only dashboard and the
 * recovery command can both import it.
 *
 * The output is blank-line separated records of `worktree <path>`, `HEAD <sha>`,
 * then `branch <ref>` | `detached` | `bare`, plus optional `locked` and
 * `prunable <reason>` lines. Those two are ignored: a locked or prunable
 * worktree keeps its row (the dashboard shows its cleanliness as unknown).
 */

export interface WorktreeRecord {
  path: string;
  /** The checked-out commit; "" for a bare repository, which has none. */
  head: string;
  /** The full ref (`refs/heads/main`); null for a detached HEAD and a bare repository. */
  ref: string | null;
  detached: boolean;
  bare: boolean;
}

export function parseWorktreeRecords(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | null = null;
  const flush = (): void => {
    if (current !== null) records.push(current);
    current = null;
  };
  for (const line of porcelain.split("\n")) {
    const text = line.trim();
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length).trim(), head: "", ref: null, detached: false, bare: false };
    } else if (text === "") {
      flush();
    } else if (current !== null) {
      if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) current.ref = line.slice("branch ".length).trim();
      else if (text === "detached") current.detached = true;
      else if (text === "bare") current.bare = true;
    }
  }
  flush();
  return records;
}

/** `refs/heads/lease/a/1` -> `lease/a/1`; a ref outside refs/heads is returned unchanged. */
export function shortBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}
