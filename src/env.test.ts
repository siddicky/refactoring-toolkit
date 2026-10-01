import { describe, expect, test } from "bun:test";

import { EnvError, envInt, envString } from "./env.js";

describe("envString", () => {
  test("a set value is trimmed", () => {
    expect(envString("X", { X: "  value  " })).toBe("value");
  });

  test("unset, empty and whitespace-only are all unset", () => {
    expect(envString("X", {})).toBeUndefined();
    expect(envString("X", { X: "" })).toBeUndefined();
    expect(envString("X", { X: " \t " })).toBeUndefined();
    expect(envString("X", { X: undefined })).toBeUndefined();
  });

  test("defaults to process.env", () => {
    const key = "TOOLKIT_ENV_TEST_STRING";
    process.env[key] = " from-process ";
    try {
      expect(envString(key)).toBe("from-process");
    } finally {
      delete process.env[key];
    }
  });
});

describe("envInt", () => {
  const read = (value: string | undefined, opts: { min?: number; max?: number } = {}) =>
    envInt("N", { ...opts, env: value === undefined ? {} : { N: value } });

  test("unset or blank is undefined, not 0 and not NaN", () => {
    expect(read(undefined)).toBeUndefined();
    expect(read("")).toBeUndefined();
    expect(read("  ")).toBeUndefined();
  });

  test("whole digits are read, surrounding whitespace ignored", () => {
    expect(read("7")).toBe(7);
    expect(read(" 42 ")).toBe(42);
    expect(read("0")).toBe(0);
  });

  test("anything parseInt would half-read is an error: units, fractions, exponents, signs, hex", () => {
    for (const bad of ["20m", "30s", "1.5", "1e6", "-5", "+5", "0x10", "abc", "1 2"]) {
      expect(() => read(bad)).toThrow(EnvError);
    }
    expect(() => read("20m")).toThrow('N must be a whole number (got "20m")');
  });

  test("bounds are inclusive and named in the message", () => {
    expect(read("1", { min: 1 })).toBe(1);
    expect(() => read("0", { min: 1 })).toThrow('N must be a whole number >= 1 (got "0")');
    expect(read("65535", { min: 1, max: 65535 })).toBe(65535);
    expect(() => read("65536", { min: 1, max: 65535 })).toThrow("N must be a whole number between 1 and 65535");
    expect(() => read("9", { max: 8 })).toThrow("N must be a whole number <= 8");
  });

  test("a number beyond the safe integers is rejected rather than rounded", () => {
    expect(() => read("99999999999999999999")).toThrow(EnvError);
  });
});
