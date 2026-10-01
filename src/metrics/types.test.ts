import { describe, expect, test } from "bun:test";
import {
  fileFromIdentity,
  fileFromSanitizedKey,
  identityKeyOf,
  sanitizeFileKey,
} from "./types.js";

describe("identity key helpers (C46)", () => {
  test("sanitize and its single inverse round-trip for ordinary paths", () => {
    expect(sanitizeFileKey("src/Auth/LdapAuth.php")).toBe("src__Auth__LdapAuth.php");
    expect(fileFromSanitizedKey("src__Auth__LdapAuth.php")).toBe("src/Auth/LdapAuth.php");
    expect(fileFromIdentity(identityKeyOf("src/Auth/LdapAuth.php", 2))).toEqual({
      file: "src/Auth/LdapAuth.php",
      round: 2,
    });
  });

  test("the inverse is lossy for a path containing __ (documented: the renderer prefers verdict files)", () => {
    const identity = identityKeyOf("src/__tests__/Foo.php", 1);
    expect(identity).toBe("src____tests____Foo.php#1");
    expect(fileFromIdentity(identity)?.file).toBe("src//tests//Foo.php");
    // sanitize(inverse(x)) === x always holds, which is what the renderer matches on.
    expect(sanitizeFileKey(fileFromIdentity(identity)?.file ?? "")).toBe("src____tests____Foo.php");
  });

  test("the round must be plain decimal digits (no 1e2, 0x10, -1, empty)", () => {
    expect(fileFromIdentity("a#1e2")).toBeNull();
    expect(fileFromIdentity("a#0x10")).toBeNull();
    expect(fileFromIdentity("a#-1")).toBeNull();
    expect(fileFromIdentity("a#")).toBeNull();
    expect(fileFromIdentity("a#12")).toEqual({ file: "a", round: 12 });
    expect(fileFromIdentity("#1")).toBeNull();
  });
});
