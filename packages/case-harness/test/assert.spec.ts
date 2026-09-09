// The equality the assertion helpers read by.
//
// A specification states a figure of `0`; a build reaches it through arithmetic
// and answers IEEE's negative zero, which is numerically zero and prints as
// `0`. The helpers read `+0` and `-0` as one value, so that figure is the one the
// specification stated rather than a verdict of "Expected: 0 / Actual: 0". The
// rest of `Object.is` stays: `NaN` is `NaN`, and a residue of `1e-14` is not
// zero — that is what the tolerance helpers are for.

import { expect, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../src/index";

it("reads negative zero as the zero a specification states", () => {
  expect(() => assertEqual(-0, 0)).not.toThrow();
  expect(() => assertEqual(0, -0)).not.toThrow();
  expect(() => assertNotEqual(-0, 0)).toThrow(/Expected: not 0/);
  expect(() =>
    assertDeepEqual({ ax: -0, ay: -600 }, { ax: 0, ay: -600 }),
  ).not.toThrow();
  expect(() => assertDeepEqual([-0], [0])).not.toThrow();
});

it("keeps the rest of Object.is", () => {
  expect(() => assertEqual(Number.NaN, Number.NaN)).not.toThrow();
  expect(() => assertEqual(Number.NaN, 0)).toThrow(/Expected: 0/);
  expect(() => assertEqual(7.3e-14, 0)).toThrow(/Expected: 0/);
  expect(() => assertEqual("0", 0)).toThrow(/Expected: 0/);
  expect(() => assertNotEqual(1, 0)).not.toThrow();
});
