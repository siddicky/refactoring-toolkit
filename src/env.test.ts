import { describe, expect, test } from "bun:test";

import { EnvError, envFlag, envInt, envString, parseSwitch } from "./env.js";

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

describe("parseSwitch and envFlag", () => {
  test("on for 1/true/yes/on and off for 0/false/no/off, in any case and with spaces", () => {
    for (const on of ["1", "true", "TRUE", "Yes", " on "]) expect(parseSwitch(on)).toBe(true);
    for (const off of ["0", "false", "False", "NO", " off "]) expect(parseSwitch(off)).toBe(false);
  });

  test("anything else is null, never a default", () => {
    for (const other of ["", "2", "y", "banana", "tru", "on off"]) expect(parseSwitch(other)).toBeNull();
  });

  test("envFlag: unset and blank give the fallback, either way round", () => {
    for (const env of [{}, { F: "" }, { F: "  " }]) {
      expect(envFlag("F", true, env)).toBe(true);
      expect(envFlag("F", false, env)).toBe(false);
    }
    expect(envFlag("F", true, { F: "off" })).toBe(false);
    expect(envFlag("F", false, { F: "yes" })).toBe(true);
  });

  test("envFlag: an unrecognised value is an EnvError naming the variable and the value", () => {
    expect(() => envFlag("F", true, { F: "banana" })).toThrow(EnvError);
    expect(() => envFlag("F", true, { F: "banana" })).toThrow(
      'F must be one of 1/true/yes/on or 0/false/no/off (got "banana")',
    );
  });
});
