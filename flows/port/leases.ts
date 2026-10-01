/**
 * Lease-store plumbing shared by the sequential loop and the per-file child
 * flow: the pp-lease attribute bound as a sync LeaseStore for one step
 * invocation, and the single WorktreePool factory every lease/release step goes
 * through.
 */

import type { AttributeMap, Context } from "@superdurable/dex";

import { WorktreePool, type LeaseRecord, type LeaseStore } from "../../src/git/worktree.js";
import { LEASE_SLOT_CAP, ppLease } from "./state.js";

const PP_LEASE_INSTANCE = "pool";

/** Binds the pp-lease map instance as a sync LeaseStore for one invocation. */
export function bindLeaseStore(ctx: Context, map: AttributeMap<Record<string, LeaseRecord>>): LeaseStore {
  const read = (): Record<string, LeaseRecord> => map.get(ctx, PP_LEASE_INSTANCE) ?? {};
  return {
    get: (file) => read()[file],
    put: (record) => {
      const table = read();
      table[record.file] = record;
      map.set(ctx, PP_LEASE_INSTANCE, table);
    },
    remove: (file) => {
      const table = read();
      delete table[file];
      map.set(ctx, PP_LEASE_INSTANCE, table);
    },
    list: () => Object.values(read()),
  };
}

/**
 * The worktree pool of one step invocation: bound to this flow's own pp-lease
 * store (the cap is enforced per store; each per-file child owns its own) and
 * capped at LEASE_SLOT_CAP.
 */
export function leasePool(ctx: Context, roots: { repoRoot: string; worktreeRoot: string }): WorktreePool {
  return new WorktreePool(roots.repoRoot, roots.worktreeRoot, bindLeaseStore(ctx, ppLease), LEASE_SLOT_CAP);
}
