// Wick — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// Most of these are the shared validator harness's
// (`@clockwyrks/case-harness`), because what they are FOR is the runner's
// contract rather than this case's: the runner stores each failed check as an
// expected/actual pair and the console renders that pair to the reviewer, so
// every check in every validator project throws a message of exactly the shape
// the runner extracts —
//
//   Expected: at most 8
//   Actual: 9.097252332435328
//
// — and the reviewer reads the bound the case set beside the value the build
// produced, and nothing else. A case that wrote its own set would be restating
// that contract, and a case that drifted from it would report a verdict the
// console could not render.
//
// Every helper takes an optional trailing `context`: what a check that runs the
// same comparison many times over says to tell one failure from another
// (`moth 3 after tick 12: hp`), or what a harness reading names as the
// requirement the build missed. It lands on the `Expected:` line, after the
// bound, in parentheses:
//
//   Expected: within 0.01 of 4 (moth 3 after tick 12: hp)
//   Actual: 0.4
//
// so the pair stays two lines and the runner still reads it as one.
//
// WHY THE RE-EXPORT IS WRITTEN OUT NAME BY NAME. Two of the shared names ask a
// DIFFERENT question here, and one whole family of them rests on a structural
// comparison this case reads differently — see the two sections below. A star
// re-export would leave which of each pair a suite gets to a rule about module
// resolution, where nearly thirteen hundred call sites deserve to see the choice
// stated. What is imported below is exactly what this project means to take.
//
// This file stays because the suites next door say `from "../assert"`, and that
// is the right thing for them to say: an assertion is the vocabulary a check
// states its verdict in, not a package a check depends on.

export {
  fail,
  assertEqual,
  assertNotEqual,
  assertCloseTo,
  assertLessThan,
  assertLessThanOrEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertBetween,
  assertLength,
  assertHasProperty,
  assertNull,
  assertNotNull,
  assertUndefined,
  assertDefined,
  assertTrue,
  assertTruthy,
  assertMatches,
  assertThrows,
  assertDoesNotThrow,
  assertNearFraction,
  assertAngleNear,
  assertEachIn,
} from "./case-harness/assert";

import { fail } from "./case-harness/assert";

/* -------------------------------------------------------------------------- */
/* Rendering a failure                                                        */
/* -------------------------------------------------------------------------- */
//
// The package does not export the two renderers its own messages are built from
// — they are private to it, and rightly so: they are the shape of the runner's
// contract rather than an extension point. So the helpers below carry their own
// three-line copies, which is the whole of what "one `Expected:` line, one
// `Actual:` line" costs to restate.

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

/* -------------------------------------------------------------------------- */
/* The structural comparison, and the three helpers that rest on it           */
/* -------------------------------------------------------------------------- */
//
// THIS CASE READS A FIELD THAT IS PRESENT AND `undefined` AS A FIELD THAT IS NOT
// THERE, and the shared harness's `deepEquals` does not: it counts the key and
// fails on the length. That is not a nicety here. `specs/instrumentation.md`
// leaves several snapshot fields OPTIONAL — a zone reports a `width` and a
// `height` only for the kinds that have them — so a build that spells an absent
// field `width: undefined` rather than leaving it out has reported exactly what
// the specification asks for. Under the shared reading every such snapshot would
// fail its comparison against `IDLE_RUN` and against every expected entity in the
// project, on a distinction JSON itself does not draw.
//
// The comparison is private, and `assertDeepEqual`, `assertContains` and
// `assertNotContains` are re-declared here rather than re-exported, because each
// of them closes over whichever comparison its own module declared — taking the
// shared ones would take the shared reading with them, silently.

/**
 * Structural equality over the JSON-shaped values the suites compare. Leaves
 * are read as the shared `assertEqual` reads them: by `Object.is`, with `+0`
 * and `-0` the same value, since a figure a build reached as negative zero is
 * the `0` a specification states.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b) || (a === 0 && b === 0)) return true;
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

/** `actual` and `unwanted` are structurally different (JSON-comparable values). */
export function assertNotDeepEqual(
  actual: unknown,
  unwanted: unknown,
  context?: string,
): void {
  if (deepEquals(actual, unwanted)) {
    fail(phrase(`not ${show(unwanted)}`, context), actual);
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

/** A string does not contain `needle`, or an array holds no equal element. */
export function assertNotContains(
  container: string | readonly unknown[],
  needle: unknown,
  context?: string,
): void {
  const holds =
    typeof container === "string"
      ? typeof needle === "string" && container.includes(needle)
      : container.some((item) => deepEquals(item, needle));
  if (holds) fail(phrase(`not containing ${show(needle)}`, context), container);
}

/* -------------------------------------------------------------------------- */
/* The tolerance this case states its figures with                            */
/* -------------------------------------------------------------------------- */

/**
 * `|actual − expected| <= tolerance`, an absolute bound: the spelling for a
 * figure the specification fixes with one of the suite's stated tolerances
 * (`REAL_EPS`, `MOTION_EPS`, `ANGLE_EPS` in `constants.ts`).
 *
 * A NAME THE SHARED SET ALSO CARRIES, FOR A DIFFERENT READING, and this is the
 * one this project is bound to. The two differ twice over, and both differences
 * are visible:
 *
 *   - The shared `assertNear` fails on ANY non-finite `actual`. This one returns
 *     early on `actual === expected`, so two equal infinities are within every
 *     tolerance, which is what the twelve hundred call sites here were written
 *     against.
 *   - It phrases the bound `expected +/- tolerance`; this one phrases it
 *     `within tolerance of expected`, which is the `Expected:` line every
 *     reviewer of this case has read.
 *
 * Folding them would rewrite every failure message in the project and quietly
 * move the verdict on any figure that reached infinity, so the shared one is
 * deliberately not re-exported above and this one stands under the name.
 */
export function assertNear(
  actual: number,
  expected: number,
  tolerance: number,
  context?: string,
): void {
  if (actual === expected) return;
  if (!(Math.abs(actual - expected) <= tolerance)) {
    fail(phrase(`within ${tolerance} of ${expected}`, context), actual);
  }
}

/** Both components of a point or vector are within `tolerance` of `expected`'s. */
export function assertPointNear(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  tolerance: number,
  context?: string,
): void {
  const off = Math.max(
    Math.abs(actual.x - expected.x),
    Math.abs(actual.y - expected.y),
  );
  if (!(off <= tolerance)) {
    fail(
      phrase(`within ${tolerance} of (${expected.x}, ${expected.y})`, context),
      `(${actual.x}, ${actual.y})`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Two the shared set does not carry at all                                   */
/* -------------------------------------------------------------------------- */

/** `typeof actual` is `type`. */
export function assertTypeOf(
  actual: unknown,
  type: "number" | "string" | "boolean" | "object" | "function",
  context?: string,
): void {
  if (typeof actual !== type) {
    fail(phrase(`a ${type}`, context), typeof actual);
  }
}

/** The condition does not hold. */
export function assertFalse(condition: boolean, context?: string): void {
  if (condition) fail(phrase("false", context), condition);
}
