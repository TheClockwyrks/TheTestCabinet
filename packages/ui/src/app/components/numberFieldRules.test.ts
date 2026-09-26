import { describe, expect, it } from "vitest";
import { readNumberField } from "./numberFieldRules";

const RUNS = { label: "Run count", min: 1, max: 20, integer: true };

describe("readNumberField", () => {
  // The whole reason this module exists: a cleared field is a state the operator is
  // entitled to leave the input in, reported as "nothing here yet" rather than
  // silently read as the zero `Number("")` produces.
  it("reports an empty required field as empty, not as zero", () => {
    const verdict = readNumberField("", RUNS);
    expect(verdict.value).toBeUndefined();
    expect(verdict.valid).toBe(false);
    expect(verdict.problem).toBe("empty");
    expect(verdict.message).toBe("Run count is required.");
  });

  it("reports whitespace the same way, since it is not an entry either", () => {
    expect(readNumberField("   ", RUNS).problem).toBe("empty");
  });

  // A field standing in for a default has an empty answer, and it is `undefined`
  // rather than a fault — which is what lets clearing it drop an override.
  it("accepts an empty optional field as no value at all", () => {
    const verdict = readNumberField("", { ...RUNS, optional: true });
    expect(verdict.valid).toBe(true);
    expect(verdict.value).toBeUndefined();
    expect(verdict.problem).toBeNull();
    expect(verdict.message).toBeNull();
  });

  it("reads a value inside the range", () => {
    const verdict = readNumberField("5", RUNS);
    expect(verdict).toMatchObject({
      raw: "5",
      value: 5,
      valid: true,
      problem: null,
      message: null,
    });
  });

  it("keeps the text exactly as typed", () => {
    expect(readNumberField(" 007 ", RUNS)).toMatchObject({
      raw: " 007 ",
      value: 7,
      valid: true,
    });
  });

  it("refuses text that names no number", () => {
    for (const raw of ["abc", "-", "1-2", "1,2", ""]) {
      expect(readNumberField(raw, RUNS).valid).toBe(false);
    }
    expect(readNumberField("abc", RUNS).message).toBe(
      "Run count must be a number.",
    );
  });

  it("refuses an infinity, which is finite-looking to `Number` alone", () => {
    expect(readNumberField("Infinity", RUNS).problem).toBe("not-a-number");
  });

  it("refuses a fraction where whole numbers are asked for", () => {
    expect(readNumberField("1.5", RUNS)).toMatchObject({
      problem: "not-an-integer",
      message: "Run count must be a whole number.",
    });
    // …and accepts it where they are not.
    expect(readNumberField("1.5", { label: "Share", min: 0 }).value).toBe(1.5);
  });

  it("refuses a value below the floor", () => {
    expect(readNumberField("0", RUNS)).toMatchObject({
      problem: "below-min",
      message: "Run count must be 1 or more.",
    });
  });

  it("refuses a value above the ceiling", () => {
    expect(readNumberField("21", RUNS)).toMatchObject({
      problem: "above-max",
      message: "Run count must be 20 or less.",
    });
  });

  it("accepts both ends of the range", () => {
    expect(readNumberField("1", RUNS).valid).toBe(true);
    expect(readNumberField("20", RUNS).valid).toBe(true);
  });

  it("names an unlabelled field generically", () => {
    expect(readNumberField("").message).toBe("This field is required.");
  });

  it("bounds a field is not given do not constrain it", () => {
    expect(readNumberField("-4000.5").value).toBe(-4000.5);
  });
});
