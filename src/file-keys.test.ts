import { describe, expect, test } from "bun:test";

import {
  fileFromIdentity,
  fileFromSanitizedKey,
  identityKeyOf,
  sanitizeFileKey,
  stripDotSlash,
} from "./file-keys.js";
import * as metricsTypes from "./metrics/types.js";

describe("stripDotSlash", () => {
  test("drops one leading ./ so ./src/a.ts and src/a.ts compare equal", () => {
    expect(stripDotSlash("./src/a.ts")).toBe("src/a.ts");
    expect(stripDotSlash("src/a.ts")).toBe("src/a.ts");
    expect(stripDotSlash("./a.ts")).toBe("a.ts");
  });

  test("touches nothing else: parent paths, a bare dot, an inner ./ and a second ./", () => {
    expect(stripDotSlash("../src/a.ts")).toBe("../src/a.ts");
    expect(stripDotSlash(".")).toBe(".");
    expect(stripDotSlash(".hidden/a.ts")).toBe(".hidden/a.ts");
    expect(stripDotSlash("src/./a.ts")).toBe("src/./a.ts");
    expect(stripDotSlash("././a.ts")).toBe("./a.ts");
    expect(stripDotSlash("")).toBe("");
  });
});

describe("file keys", () => {
  test("sanitizing swaps every / for __ and nothing else", () => {
    expect(sanitizeFileKey("src/Auth/LdapAuth.php")).toBe("src__Auth__LdapAuth.php");
    expect(sanitizeFileKey("Money.php")).toBe("Money.php");
    expect(sanitizeFileKey("")).toBe("");
  });

  test("the identity key is `<sanitized file>#<round>` and its inverse reads it back", () => {
    expect(identityKeyOf("src/a.php", 3)).toBe("src__a.php#3");
    expect(fileFromIdentity("src__a.php#3")).toEqual({ file: "src/a.php", round: 3 });
    expect(fileFromSanitizedKey("src__a.php")).toBe("src/a.php");
  });

  test("the metrics module re-exports these very functions (one definition)", () => {
    expect(metricsTypes.sanitizeFileKey).toBe(sanitizeFileKey);
    expect(metricsTypes.fileFromSanitizedKey).toBe(fileFromSanitizedKey);
    expect(metricsTypes.identityKeyOf).toBe(identityKeyOf);
    expect(metricsTypes.fileFromIdentity).toBe(fileFromIdentity);
  });
});
