/**
 * Lease-store plumbing shared by the sequential loop and the per-file child
 * flow: the pp-lease attribute bound as a sync LeaseStore for one step
 * invocation.
 */

import type { AttributeMap, Context } from "@superdurable/dex";

import type { LeaseRecord, LeaseStore } from "../../src/git/worktree.js";

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
