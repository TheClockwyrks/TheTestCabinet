// Gantry — the suite's assertions, for a build on the SIMPLE 3D engine.
// CASE-PROVIDED.
//
// THE SAME VOCABULARY THE ENGINELESS PROJECT ASSERTS THROUGH, spelled out here
// rather than re-exported from it. `validation/none/assert.ts` re-exports
// `@test-cabinet/case-harness`'s, because that package is staged into an
// engineless project for the browser machinery it also brings; there is no such
// package under an engine — a check here runs in this process over an engine the
// harness built — so the helpers are carried in the project that uses them. What
// matters is that every name, every signature and every message is the same, so a
// `<category>/<id>.test.ts` file importing `from "../assert"` is the same file in
// all three engines' directories.
//
// Every check in a validator project asserts through these helpers rather than
// through vitest's `expect`, because of where a failure ends up: the runner
// stores each failed check as an expected/actual pair and the console renders
// that pair to the reviewer. A chai message ("expected 9.097… to be less than
// or equal to 8", trailed by a stack) makes a poor pair; these helpers throw a
// message of exactly the shape the runner extracts —
//
//   Expected: at most 8
//   Actual: 9.097252332435328
//
// — so the reviewer reads the bound the case set beside the value the build
// produced, and nothing else. The first line names what the check required, the
// second the value it measured. Keep new helpers to that shape: one `Expected:`
// line, one `Actual:` line, no file paths and no prose around them.
//
// Every helper takes an optional trailing `context`: what a check that runs the
// same comparison many times over says to tell one failure from another
// (`obstacle 1 at t=0.5: theta`), or what a harness reading names as the
// requirement the build missed. It lands on the `Expected:` line, after the
// bound, in parentheses:
//
//   Expected: at most 0.01 (obstacle 1 at t=0.5: theta)
//   Actual: 0.4
//
// so the pair stays two lines and the runner still reads it as one.
//
// TWO ARE ADDED AT THE FOOT, and both are Gantry's own vocabulary rather than a
// new contract: the case states almost every tolerance as an absolute span in
// world units taken straight from `constants.ts` — `PLACE_POS_TOL`,
// `ATTACH_RADIUS`, `PLACE_YAW_TOL` — and almost every quantity it compares is a
// position.

import type { Vec3 } from "./surface";

/** The `Expected:` phrase, with the check's own context after it when it gave one. */
function phrase(expected: string, context?: string): string {
  return context === undefined ? expected : `${expected} (${context})`;
}

/** A value rendered for a failure message, on one line. */
function show(value: unknown): string {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Throw the failure the runner extracts: what was required, what was measured.
 *
 * Exported for the one reading no comparison states — a harness that found the
 * build's surface missing names what the specification requires as `expected`
 * and what it found as `actual`.
 */
export function fail(expected: string, actual: unknown): never {
  throw new Error(`Expected: ${expected}\nActual: ${show(actual)}`);
}

/** `actual` is `expected`, by `Object.is`. For deep structure, `assertDeepEqual`. */
export function assertEqual(
  actual: unknown,
  expected: unknown,
  context?: string,
): void {
  if (!Object.is(actual, expected))
    fail(phrase(show(expected), context), actual);
}

/** `actual` is not `unwanted`, by `Object.is`. */
export function assertNotEqual(
  actual: unknown,
  unwanted: unknown,
  context?: string,
): void {
  if (Object.is(actual, unwanted)) {
    fail(phrase(`not ${show(unwanted)}`, context), actual);
  }
}

/** `actual` and `expected` are structurally equal (JSON-comparable values). */
export function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  context?: string,
): void {
  if (!deepEquals(actual, expected)) {
    fail(phrase(show(expected), context), actual);
  }
}

/** Structural equality over the JSON-shaped values the suites compare. */
function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => deepEquals(item, b[i]))
    );
  }
  if (
    typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const left = Object.entries(a).filter(([, v]) => v !== undefined);
    const right = Object.entries(b).filter(([, v]) => v !== undefined);
    return (
      left.length === right.length &&
      left.every(
        ([key, value]) =>
          key in b && deepEquals(value, (b as Record<string, unknown>)[key]),
      )
    );
  }
  return false;
}

/**
 * `actual` is within half a unit of the `digits`-th decimal place of
 * `expected` — the same reading as vitest's `toBeCloseTo(expected, digits)`,
 * so a converted check keeps its tolerance. Two equal infinities are close, as
 * they are there; nothing else infinite is.
 */
export function assertCloseTo(
  actual: number,
  expected: number,
  digits = 2,
  context?: string,
): void {
  if (actual === expected) return;
  const tolerance = 0.5 * 10 ** -digits;
  if (!(Math.abs(actual - expected) < tolerance)) {
    fail(phrase(`within ${tolerance} of ${expected}`, context), actual);
  }
}

/** `actual < bound`. */
export function assertLessThan(
  actual: number,
  bound: number,
  context?: string,
): void {
  if (!(actual < bound)) fail(phrase(`less than ${bound}`, context), actual);
}

/** `actual <= bound`. */
export function assertLessThanOrEqual(
  actual: number,
  bound: number,
  context?: string,
): void {
  if (!(actual <= bound)) fail(phrase(`at most ${bound}`, context), actual);
}

/** `actual > bound`. */
export function assertGreaterThan(
  actual: number,
  bound: number,
  context?: string,
): void {
  if (!(actual > bound)) fail(phrase(`greater than ${bound}`, context), actual);
}

/** `actual >= bound`. */
export function assertGreaterThanOrEqual(
  actual: number,
  bound: number,
  context?: string,
): void {
  if (!(actual >= bound)) fail(phrase(`at least ${bound}`, context), actual);
}

/** `min <= actual <= max`, both ends in. */
export function assertBetween(
  actual: number,
  min: number,
  max: number,
  context?: string,
): void {
  if (!(actual >= min && actual <= max)) {
    fail(phrase(`between ${min} and ${max}`, context), actual);
  }
}

/** A string contains `needle`, or an array contains an equal element. */
export function assertContains(
  container: string | readonly unknown[],
  needle: unknown,
  context?: string,
): void {
  const holds =
    typeof container === "string"
      ? typeof needle === "string" && container.includes(needle)
      : container.some((item) => deepEquals(item, needle));
  if (!holds) fail(phrase(`containing ${show(needle)}`, context), container);
}

/** A string or array has exactly `length` elements. */
export function assertLength(
  actual: string | readonly unknown[],
  length: number,
  context?: string,
): void {
  if (actual.length !== length) {
    fail(phrase(`length ${length}`, context), actual.length);
  }
}

/** The object has a `key` property, own or inherited, whatever its value. */
export function assertHasProperty(
  actual: object,
  key: string,
  context?: string,
): void {
  if (!(key in actual)) {
    fail(phrase(`a ${show(key)} property`, context), Object.keys(actual));
  }
}

/** The value is `null`. */
export function assertNull(actual: unknown, context?: string): void {
  if (actual !== null) fail(phrase("null", context), actual);
}

/** The value is anything but `null`. */
export function assertNotNull(actual: unknown, context?: string): void {
  if (actual === null) fail(phrase("not null", context), actual);
}

/** The value is `undefined`. */
export function assertUndefined(actual: unknown, context?: string): void {
  if (actual !== undefined) fail(phrase("undefined", context), actual);
}

/** The value is neither `null` nor `undefined`. */
export function assertDefined(actual: unknown, context?: string): void {
  if (actual === null || actual === undefined) {
    fail(phrase("a value", context), actual);
  }
}

/** The condition holds. The blunt one; prefer a comparison that names values. */
export function assertTrue(condition: boolean, context?: string): void {
  if (!condition) fail(phrase("true", context), condition);
}

/** The value is truthy: a reading that is there at all, whatever it holds. */
export function assertTruthy(actual: unknown, context?: string): void {
  if (!actual) fail(phrase("a truthy value", context), actual);
}

/** The string matches `pattern` (a regular expression, or a substring). */
export function assertMatches(
  actual: string,
  pattern: RegExp | string,
  context?: string,
): void {
  const holds =
    typeof pattern === "string"
      ? actual.includes(pattern)
      : pattern.test(actual);
  if (!holds) fail(phrase(`matching ${String(pattern)}`, context), actual);
}

/** Calling `run` throws. */
export function assertThrows(run: () => unknown, context?: string): void {
  try {
    run();
  } catch {
    return;
  }
  fail(phrase("a thrown error", context), "no error thrown");
}

/** Calling `run` returns without throwing. */
export function assertDoesNotThrow(run: () => unknown, context?: string): void {
  try {
    run();
  } catch (error) {
    fail(
      phrase("no thrown error", context),
      error instanceof Error ? error.message : error,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Tolerance-aware comparison                                                 */
/* -------------------------------------------------------------------------- */
//
// A case commonly states its tolerances as absolute spans rather than as decimal
// places — an arc position within 0.5 units, an angle within 1 degree, a duration
// within 2 ticks — so these take the span directly and name it in the failure.
// Every bound a suite passes here comes from the case's own `constants.ts`, so
// the pair a reviewer reads is the case's figure beside the build's.

/** `actual` is within `tolerance` of `expected`, inclusive. */
export function assertNear(
  actual: number,
  expected: number,
  tolerance: number,
  context?: string,
): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    fail(phrase(`${expected} +/- ${tolerance}`, context), actual);
  }
}

/** `actual` is within `fraction` of `expected`, as a proportion of `expected`. */
export function assertNearFraction(
  actual: number,
  expected: number,
  fraction: number,
  context?: string,
): void {
  assertNear(actual, expected, Math.abs(expected) * fraction, context);
}

/**
 * Two angles in degrees are within `tolerance` of each other, the short way
 * round.
 *
 * `specs/instrumentation.md` normalizes every reported angle into `[0, 360)`, so
 * 359.5 and 0.2 are seven tenths of a degree apart rather than 359.3.
 */
export function assertAngleNear(
  actual: number,
  expected: number,
  tolerance: number,
  context?: string,
): void {
  const wrapped = ((((actual - expected) % 360) + 540) % 360) - 180;
  if (!Number.isFinite(actual) || Math.abs(wrapped) > tolerance) {
    fail(phrase(`${expected} degrees +/- ${tolerance}`, context), actual);
  }
}

/** Every element of `actual` is a member of `allowed`. */
export function assertEachIn(
  actual: readonly unknown[],
  allowed: readonly unknown[],
  context?: string,
): void {
  const stray = actual.find((item) => !allowed.includes(item));
  if (stray !== undefined) {
    fail(phrase(`one of ${show(allowed)}`, context), stray);
  }
}

/* -------------------------------------------------------------------------- */
/* Gantry's own two                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `actual` is within `tolerance` of `expected`, inclusive.
 *
 * The shared harness spells this `assertNear`, which is the name every other
 * engineless project uses; Gantry's suites read `assertClose`, and the two are
 * the same function rather than two tolerances. Both are exported so a check
 * copied from another case still compiles.
 */
export const assertClose = assertNear;

/**
 * Two world positions are within `tolerance` of each other, measured as the
 * straight-line distance between them.
 *
 * Not three `assertNear`s on the axes: `specs/rigging.md` states the set-down
 * tolerance as one distance ("its lift point within `PLACE_POS_TOL` of the
 * target"), so a per-axis reading would pass a load `PLACE_POS_TOL` out on each
 * of three axes — over `1.7` times the tolerance the specification set.
 */
export function assertVec3Near(
  actual: Vec3,
  expected: Vec3,
  tolerance: number,
  context?: string,
): void {
  const gap = Math.hypot(
    actual.x - expected.x,
    actual.y - expected.y,
    actual.z - expected.z,
  );
  if (!Number.isFinite(gap) || gap > tolerance) {
    const where = `(${expected.x}, ${expected.y}, ${expected.z})`;
    fail(
      context === undefined
        ? `within ${tolerance} of ${where}`
        : `within ${tolerance} of ${where} (${context})`,
      `(${actual.x}, ${actual.y}, ${actual.z}), ${gap.toFixed(4)} away`,
    );
  }
}
