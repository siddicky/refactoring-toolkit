/**
 * C36 (dex client part) — worker bind/target config drift.
 *
 * Before: dexConfigFromEnv never set workerBindAddress and startDexWorker
 * hard-coded `config.workerBindAddress ?? "127.0.0.1:8803"` (a literal
 * duplicating DEFAULT_WORKER_TARGET_ADDRESS), so DEX_WORKER_TARGET could only
 * be set to an address the worker would not bind: a non-default value made
 * flows dispatch to a port nothing listens on. startDexWorker also leaked its
 * cache and client when the worker failed to start.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_WORKER_TARGET_ADDRESS,
  dexConfigFromEnv,
  releaseOnFailure,
  startDexWorker,
} from "./client.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("dexConfigFromEnv worker addresses", () => {
  test("no env: target and bind are the one shared default", () => {
    const c = dexConfigFromEnv({});
    expect(DEFAULT_WORKER_TARGET_ADDRESS).toBe("127.0.0.1:8803");
    expect(c.workerTargetAddress).toBe(DEFAULT_WORKER_TARGET_ADDRESS);
    expect(c.workerBindAddress).toBe(DEFAULT_WORKER_TARGET_ADDRESS);
  });

  test("DEX_WORKER_TARGET alone moves the bind with it (the advertised address is the bound address)", () => {
    const c = dexConfigFromEnv({ DEX_WORKER_TARGET: "127.0.0.1:9000" });
    expect(c.workerTargetAddress).toBe("127.0.0.1:9000");
    expect(c.workerBindAddress).toBe("127.0.0.1:9000");
  });

  test("DEX_WORKER_BIND overrides the bind independently of the advertised target (wildcard bind, remote target)", () => {
    const c = dexConfigFromEnv({ DEX_WORKER_TARGET: "worker.internal:8803", DEX_WORKER_BIND: "0.0.0.0:8803" });
    expect(c.workerTargetAddress).toBe("worker.internal:8803");
    expect(c.workerBindAddress).toBe("0.0.0.0:8803");
  });

  test("blank / whitespace values are ignored", () => {
    const c = dexConfigFromEnv({ DEX_WORKER_TARGET: "  ", DEX_WORKER_BIND: "" });
    expect(c.workerTargetAddress).toBe(DEFAULT_WORKER_TARGET_ADDRESS);
    expect(c.workerBindAddress).toBe(DEFAULT_WORKER_TARGET_ADDRESS);
  });

  test("server address and cache dir behaviour is unchanged", () => {
    const c = dexConfigFromEnv({ DEX_SERVER_ADDRESS: " dex.internal:8801 ", DEX_BLOB_CACHE_DIR: "/tmp/x" });
    expect(c.serverAddress).toBe("dex.internal:8801");
    expect(c.blobCacheDir).toBe("/tmp/x");
    expect(dexConfigFromEnv({}).blobCacheDir).toBe(".dex-cache");
  });
});

describe("startDexWorker", () => {
  test("the configured bind address is what the Worker is given (an invalid one is rejected by the SDK with its own message)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dex-client-config-"));
    tmpDirs.push(dir);
    await expect(
      startDexWorker([], {
        serverAddress: "127.0.0.1:1",
        blobCacheDir: dir,
        maxBlobCacheBytes: 1024 * 1024,
        workerBindAddress: "no-port-here",
      }),
    ).rejects.toThrow(/Worker bind address requires port/);
  });
});

describe("releaseOnFailure", () => {
  test("a failing start runs every cleanup in order and rethrows the START error", async () => {
    const order: string[] = [];
    const boom = new Error("cannot start");
    await expect(
      releaseOnFailure(
        async () => {
          throw boom;
        },
        [
          () => void order.push("worker"),
          async () => void order.push("client"),
          () => {
            order.push("cache");
            throw new Error("cleanup failure must not mask the start error");
          },
        ],
      ),
    ).rejects.toBe(boom);
    expect(order).toEqual(["worker", "client", "cache"]);
  });

  test("a successful start runs no cleanup and returns the value", async () => {
    let cleaned = false;
    const value = await releaseOnFailure(async () => 42, [
      () => {
        cleaned = true;
      },
    ]);
    expect(value).toBe(42);
    expect(cleaned).toBe(false);
  });
});
